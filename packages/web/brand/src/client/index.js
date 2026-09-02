import shellCss from "./styles/shell.css";
import historyCss from "./styles/history.css";
import { BrandMark, BrandName, keepProductTitle } from "./brand.js";
import { HideOpenDocument, RetireStatsLine } from "./shell-overrides.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(
    ctx,
    "@lares/brand",
    `${shellCss}
${historyCss}`,
    "lares-brand-css",
  );

  ctx.effect(() => keepProductTitle(), "lares-document-title");

  ctx.inject(["slots"], (scope) => {
    scope.slots.inject("sidebar.brand.mark", () =>
      scope.slots.register({ name: "sidebar.brand.mark", id: "lares-mark", priority: -1 }, BrandMark),
    );
    scope.slots.inject("sidebar.brand.name", () =>
      scope.slots.register({ name: "sidebar.brand.name", id: "lares-name", priority: -1 }, BrandName),
    );
    scope.slots.inject("conversation.hero.brand.mark", () =>
      scope.slots.register(
        { name: "conversation.hero.brand.mark", id: "lares-mark", priority: -1 },
        BrandMark,
      ),
    );
    scope.slots.inject("settings.action", () =>
      scope.slots.register(
        {
          name: "settings.action",
          id: "open-document",
          priority: -1,
        },
        HideOpenDocument,
      ),
    );
    scope.slots.inject("conversation.composer.dock", () =>
      scope.slots.register(
        { name: "conversation.composer.dock", id: "stats", priority: -1 },
        RetireStatsLine,
      ),
    );
  });
}
