// Browser half: the dsh client module system requires a closure-factory
// bundle that self-registers through window.__ModuleLoader__.load and takes
// its externals from the injected require (frozen module table, no imports).
window.__ModuleLoader__.load({
  id: "@dina/client-dina",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const { createElement } = require("react");

    function DinaBrandMark(props) {
      if (props && props.wide === false) return null;
      return createElement(
        "div",
        {
          "data-dina-brand": "1",
          style: {
            padding: "6px 12px 10px",
            fontSize: 12,
            lineHeight: 1.3,
            opacity: 0.72,
            userSelect: "none",
          },
        },
        "Dina · Olares",
      );
    }

    exports.inject = ["slots"];

    exports.apply = function apply(ctx) {
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "dina-brand",
            order: 100,
          },
          DinaBrandMark,
        ),
      );
    };

    return module.exports;
  },
});
