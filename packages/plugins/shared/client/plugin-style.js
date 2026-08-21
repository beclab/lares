export function installPluginStyle(ctx, plugin, css, effectName = `${plugin}-css`) {
  ctx.effect(() => {
    const tag = document.createElement("style");
    tag.dataset.plugin = plugin;
    tag.dataset.pluginCss = plugin;
    tag.textContent = css;
    document.head.append(tag);
    return () => tag.remove();
  }, effectName);
}
