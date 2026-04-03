"use client";

import { useState, useEffect } from "react";

interface Config {
  [key: string]: string | undefined;
}

export default function ConfigPanel() {
  const [config, setConfig] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const update = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setDirty(false);
    } catch {
      // ignore
    }
    setSaving(false);
  };

  const wpDomain = (() => {
    try {
      return new URL(config.WP_API_URL || "").hostname;
    } catch {
      return "WordPress Site";
    }
  })();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900">Configure Migration</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Connect your WordPress site and Contentful space to get started.
        </p>

        {/* Source / Destination summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <div className="bg-white rounded-xl border-2 border-blue-200 p-5 flex items-start gap-4">
            <span className="w-10 h-10 bg-[#1877F2] rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">
                Source
              </p>
              <p className="text-base font-semibold text-gray-900 truncate">{wpDomain}</p>
              <p className="text-xs text-gray-400 truncate mt-0.5">{config.WP_API_URL}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl border-2 border-orange-200 p-5 flex items-start gap-4">
            <span className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
              <img src="/contentful-logo.png" alt="Contentful" className="w-10 h-10 rounded-lg" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-orange-600 uppercase tracking-wider">
                Destination
              </p>
              <p className="text-base font-semibold text-gray-900">Contentful Space</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Space ID: {config.CONTENTFUL_SPACE_ID} · Environment:{" "}
                {config.CONTENTFUL_ENVIRONMENT || "master"}
              </p>
            </div>
          </div>
        </div>

        {/* WordPress Connection */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <h2 className="text-sm font-semibold text-gray-900">WordPress Connection</h2>
          </div>
          <div className="space-y-4">
            <Field label="API URL" value={config.WP_API_URL || ""} onChange={(v) => update("WP_API_URL", v)} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Username" value={config.WP_USERNAME || ""} onChange={(v) => update("WP_USERNAME", v)} placeholder="Optional" />
              <Field label="App Password" value={config.WP_APP_PASSWORD || ""} onChange={(v) => update("WP_APP_PASSWORD", v)} type="password" placeholder="Optional" />
            </div>
          </div>
        </div>

        {/* Contentful Space */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
            <h2 className="text-sm font-semibold text-gray-900">Contentful Space</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Space ID" value={config.CONTENTFUL_SPACE_ID || ""} onChange={(v) => update("CONTENTFUL_SPACE_ID", v)} />
            <Field label="Environment" value={config.CONTENTFUL_ENVIRONMENT || "master"} onChange={(v) => update("CONTENTFUL_ENVIRONMENT", v)} />
            <div className="col-span-2">
              <Field label="Management Token" value={config.CONTENTFUL_MANAGEMENT_TOKEN || ""} onChange={(v) => update("CONTENTFUL_MANAGEMENT_TOKEN", v)} type="password" />
            </div>
            <div className="col-span-2">
              <Field label="Delivery Token" value={config.CONTENTFUL_DELIVERY_TOKEN || ""} onChange={(v) => update("CONTENTFUL_DELIVERY_TOKEN", v)} type="password" placeholder="Used for validation step" />
            </div>
          </div>
        </div>

        {/* Migration Options */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
          <div className="flex items-center gap-2.5 mb-5">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-400" />
            <h2 className="text-sm font-semibold text-gray-900">Migration Options</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Batch Size" value={config.BATCH_SIZE || "5"} onChange={(v) => update("BATCH_SIZE", v)} />
            <Field label="Request Delay (ms)" value={config.DELAY_MS || "1000"} onChange={(v) => update("DELAY_MS", v)} />
            <Field label="Max Asset Size (MB)" value={config.MAX_ASSET_SIZE_MB || "500"} onChange={(v) => update("MAX_ASSET_SIZE_MB", v)} />
            <Field label="Migrate Videos" value={config.MIGRATE_VIDEOS === "true" ? "Yes" : "No"} onChange={(v) => update("MIGRATE_VIDEOS", v === "Yes" ? "true" : "false")} />
          </div>
        </div>

        {/* Save */}
        {dirty && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-sm transition disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
        placeholder={placeholder}
      />
    </div>
  );
}
