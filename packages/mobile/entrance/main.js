import { createApp } from "vue";
import LaresApp from "../src/App.vue";
import "./host.css";

// Already on the Lares entrance. Same-origin /api is the Host.
// LarePass is a different origin and passes laresPortsFromAccount instead.
createApp(LaresApp, { device: "mobile" }).mount("#app");
