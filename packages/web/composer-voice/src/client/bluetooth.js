import React from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import { messageFromCode } from "@olares/lares-core/i18n/t";
import { connectBluetoothDevice, scanBluetoothDevices } from "./api.js";
import { useMountedRef } from "../../../shared/client/react-lifecycle.js";

const { useCallback, useEffect, useRef, useState } = React;
const h = React.createElement;

function failureText(t, err, fallbackKey) {
  const code = err && typeof err.message === "string" ? err.message : "";
  return messageFromCode(t, code, fallbackKey);
}

export function BluetoothDevices({ t }) {
  const [devices, setDevices] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState("");
  const [notice, setNotice] = useState(null);
  const mounted = useMountedRef();
  const abortRef = useRef(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const scan = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(true);
    setNotice(null);
    try {
      const next = await scanBluetoothDevices(controller.signal);
      if (!mounted.current) return;
      const found = Array.isArray(next?.devices) ? next.devices : [];
      setDevices(found);
      if (!found.length) setNotice({ kind: "info", text: t("settings.bluetooth.empty") });
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (mounted.current) {
        setNotice({ kind: "error", text: failureText(t, err, "error.voice_bluetooth_scan_failed") });
      }
    } finally {
      if (mounted.current) setScanning(false);
    }
  }, [mounted, t]);

  const connect = useCallback(async (address) => {
    setConnecting(address);
    setNotice(null);
    try {
      const device = await connectBluetoothDevice(address);
      if (!mounted.current) return;
      setDevices((current) => (current ?? []).map((item) => (
        item.address === address ? { ...item, ...device, connected: true } : item
      )));
    } catch (err) {
      if (mounted.current) {
        setNotice({ kind: "error", text: failureText(t, err, "error.voice_bluetooth_connect_failed") });
      }
    } finally {
      if (mounted.current) setConnecting("");
    }
  }, [mounted, t]);

  const busy = scanning || connecting !== "";

  return h(
    "div",
    { className: "lares-voice-row lares-voice-bluetooth" },
    h(
      "div",
      { className: "lares-voice-bluetooth-head" },
      h(
        "div",
        { className: "lares-voice-row-text" },
        h("div", { className: "lares-voice-row-title" }, t("settings.bluetooth.title")),
        h("div", { className: "lares-voice-hint" }, t("settings.bluetooth.hint")),
      ),
      h(
        Button,
        {
          variant: "outline",
          size: "sm",
          disabled: busy,
          onClick: scan,
        },
        scanning ? t("settings.bluetooth.scanning") : t("settings.bluetooth.scan"),
      ),
    ),
    devices?.length
      ? h(
          "ul",
          { className: "lares-voice-devices" },
          devices.map((device) => h(
            "li",
            { key: device.address, className: "lares-voice-device" },
            h(
              "div",
              { className: "lares-voice-device-name" },
              device.name,
              device.name !== device.address
                ? h("div", { className: "lares-voice-device-address" }, device.address)
                : null,
            ),
            device.connected
              ? h("span", { className: "lares-voice-device-state" }, t("settings.bluetooth.connected"))
              : h(
                  Button,
                  {
                    variant: "outline",
                    size: "sm",
                    disabled: busy,
                    onClick: () => connect(device.address),
                  },
                  connecting === device.address
                    ? t("settings.bluetooth.connecting")
                    : t("settings.bluetooth.connect"),
                ),
          )),
        )
      : null,
    notice
      ? h(
          "p",
          { className: `lares-settings-notice ${notice.kind === "error" ? "is-error" : ""}` },
          notice.text,
        )
      : null,
  );
}
