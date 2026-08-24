import shellCss from "./styles/shell.css";
import modelCss from "./styles/model.css";
import { ModelSwitch, bindLocale, registerLocale, t } from "./model-switch.js";
import { BrandMark, BrandName, keepProductTitle } from "./brand.js";
import { HideOpenDocument, RetireStatsLine, HideModelSeat } from "./shell-overrides.js";
import { installPluginStyle } from "../../../shared/client/plugin-style.js";

export const inject = [];

export function apply(ctx) {
  installPluginStyle(ctx, "@lares/client-lares", `${shellCss}\n${modelCss}`, "lares-client-css");

  ctx.effect(() => keepProductTitle(), "lares-document-title");

  ctx.inject(["locale"], (scope) => {
    bindLocale(scope.locale);
    scope.effect(() => {
      registerLocale(scope.locale);
    }, "lares-client-locale");
  });

  ctx.inject(["slots"], (scope) => {
    // Single seats: a dynamic entry shadows the shipped occupant.
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

  ctx.inject(["slots", "sessions", "modelDirectories"], (scope) => {
    const models = scope.modelDirectories;
    const sessions = scope.sessions;
    const seat = (sessionId) => {
      const directory = models.directoryFor(sessionId);
      const available = sessions.subagentAddress(sessionId) === undefined;
      return {
        available,
        directory: directory.store,
        load: () => {
          if (available) directory.load().catch(() => {});
        },
        select: (selection) =>
          available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
      };
    };

    scope.slots.inject("conversation.input.model", () =>
      scope.slots.register({ name: "conversation.input.model", priority: -1 }, HideModelSeat),
    );
    // High order → chip sits closest to the card.
    scope.slots.inject("conversation.input.dock", () =>
      scope.slots.register(
        {
          name: "conversation.input.dock",
          id: "lares-model",
          order: 100,
          label: () => t("slot.model"),
          inject: seat,
        },
        ModelSwitch,
      ),
    );
  });
}
