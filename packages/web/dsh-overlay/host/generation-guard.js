/**
 * Refuse shell / fetch calls that generate on FlowStudio around the shim, so
 * every FlowStudio job carries this user's encrypted `sref` and lands in their
 * own Files Home. Decision logic: @olares/lares-core/router/generation-guard.
 */
import { decideGenerationGuard } from "@olares/lares-core/router/generation-guard";

export const name = "lares-generation-guard";
export const inject = ["tools"];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.on("tools/pre-execute", async (exec, next) => {
    const prior = await next();
    return decideGenerationGuard({ name: exec?.name, args: exec?.arguments, prior });
  });
}
