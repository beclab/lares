import { bootLaresWeb } from "./dsh-web/boot.js";

bootLaresWeb().catch((err) => {
  console.error(err);
  process.exit(1);
});
