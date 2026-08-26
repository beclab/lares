import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  carriesWebpImage,
  transcodeWebpImages,
} from "@lares/core/media/router-images";

function square(alpha: boolean): sharp.Sharp {
  return sharp({
    create: {
      width: 8,
      height: 8,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 204, g: 0, b: 0, alpha: 0.5 } : "#c00",
    },
  });
}

async function dataUrl(mediaType: "image/webp" | "image/png", alpha = true): Promise<string> {
  const image = square(alpha);
  const bytes = await (mediaType === "image/webp" ? image.webp() : image.png()).toBuffer();
  return `data:${mediaType};base64,${bytes.toString("base64")}`;
}

function chatBody(url: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      model: "Olares/vision",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "看图" },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    }),
    "utf8",
  );
}

function imageUrlOf(body: Buffer): string {
  const payload = JSON.parse(body.toString("utf8"));
  return payload.messages[0].content[1].image_url.url;
}

async function decodedImage(url: string): Promise<sharp.Metadata> {
  const base64 = url.slice(url.indexOf(",") + 1);
  return sharp(Buffer.from(base64, "base64")).metadata();
}

test("a transparent WebP prompt image reaches Router as PNG, and its request is otherwise untouched", async () => {
  const body = chatBody(await dataUrl("image/webp"));
  assert.equal(carriesWebpImage(body), true);

  const rewritten = await transcodeWebpImages(body);
  const url = imageUrlOf(rewritten);
  assert.match(url, /^data:image\/png;base64,/);
  const decoded = await decodedImage(url);
  assert.equal(decoded.format, "png");
  assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 8, height: 8 });

  const payload = JSON.parse(rewritten.toString("utf8"));
  assert.equal(payload.model, "Olares/vision");
  assert.deepEqual(payload.messages[0].content[0], { type: "text", text: "看图" });
});

test("an opaque WebP goes to JPEG rather than growing the request", async () => {
  const url = imageUrlOf(await transcodeWebpImages(chatBody(await dataUrl("image/webp", false))));
  assert.match(url, /^data:image\/jpeg;base64,/);
  assert.equal((await decodedImage(url)).format, "jpeg");
});

test("a request Router already reads is not parsed at all", async () => {
  const body = chatBody(await dataUrl("image/png"));
  assert.equal(carriesWebpImage(body), false);
});

test("bytes that cannot be re-encoded travel as they arrived", async () => {
  const body = chatBody("data:image/webp;base64,bm90LWFuLWltYWdl");
  assert.equal(carriesWebpImage(body), true);
  assert.equal((await transcodeWebpImages(body)).toString("utf8"), body.toString("utf8"));

  const truncated = Buffer.from('{"messages":[{"url":"data:image/webp;base64,', "utf8");
  assert.equal((await transcodeWebpImages(truncated)).toString("utf8"), truncated.toString("utf8"));
});
