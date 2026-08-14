import { bootDinaWeb } from "./dsh-web/boot.js";

bootDinaWeb().catch((err) => {
  console.error(err);
  process.exit(1);
});
