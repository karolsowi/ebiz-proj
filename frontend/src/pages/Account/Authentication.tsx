import { useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import { userApiService, type UserApiKey } from "../../services/userApiService";

type ServiceType = "alpaca" | "alphavantage" | "finnhub" | "reddit" | "news";

const SERVICE_LABELS: Record<ServiceType, string> = {
  alpaca: "Alpaca Trading",
  alphavantage: "Alpha Vantage",
  finnhub: "Finnhub",
  reddit: "Reddit API",
  news: "NewsData.io",
};

const emptyKeyForm = {
  name: "",
  service: "alpaca" as ServiceType,
  apiKey: "",
  secretKey: "",
  paperTrading: true,
};

export default function Authentication() {
  const [apiKeys, setApiKeys] = useState<UserApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyKeyForm);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const loadKeys = async () => {
    setLoading(true);
    try {
      const keys = await userApiService.getApiKeys();
      setApiKeys(keys);
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "Failed to load API keys",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyKeyForm);
    setShowModal(true);
  };

  const openEdit = (key: UserApiKey) => {
    setEditingId(key.id);
    setForm({
      name: key.name,
      service: key.service as ServiceType,
      apiKey: "",
      secretKey: "",
      paperTrading: key.paperTrading ?? true,
    });
    setShowModal(true);
  };

  const handleSaveKey = async () => {
    if (!form.name.trim() || (!editingId && !form.apiKey.trim())) {
      setMessage({ type: "error", text: "Name and API key are required." });
      return;
    }
    if (form.service === "alpaca" && !editingId && !form.secretKey.trim()) {
      setMessage({ type: "error", text: "Alpaca requires a secret key." });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      if (editingId) {
        const payload: Parameters<typeof userApiService.updateApiKey>[1] = {
          name: form.name,
        };
        if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
        if (form.secretKey.trim()) payload.secretKey = form.secretKey.trim();
        if (form.service === "alpaca") payload.paperTrading = form.paperTrading;
        await userApiService.updateApiKey(editingId, payload);
      } else {
        await userApiService.addApiKey({
          name: form.name.trim(),
          service: form.service,
          apiKey: form.apiKey.trim(),
          secretKey: form.secretKey.trim() || undefined,
          paperTrading: form.paperTrading,
        });
      }
      setShowModal(false);
      setForm(emptyKeyForm);
      await loadKeys();
      setMessage({ type: "success", text: "API key saved." });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "Failed to save API key",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (key: UserApiKey) => {
    try {
      await userApiService.updateApiKey(key.id, { isActive: !key.isActive });
      await loadKeys();
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "Failed to update key",
      });
    }
  };

  const handleDelete = async (keyId: string) => {
    if (!confirm("Delete this API key?")) return;
    try {
      await userApiService.deleteApiKey(keyId);
      await loadKeys();
      setMessage({ type: "success", text: "API key removed." });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "Failed to delete key",
      });
    }
  };

  const handleChangePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setMessage({ type: "error", text: "New passwords do not match." });
      return;
    }
    setSaving(true);
    try {
      await userApiService.changePassword(
        passwordForm.currentPassword,
        passwordForm.newPassword
      );
      setShowPasswordModal(false);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setMessage({ type: "success", text: "Password changed." });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "Failed to change password",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageMeta
        title="Authentication | Inwest App"
        description="API keys and account security"
      />

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Authentication & API keys
          </h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Store keys for Alpaca, Finnhub, Reddit, and news services. Values are encrypted on
            the server. Re-run <code className="text-sm text-gray-800 dark:text-gray-300">npm run db:seed</code> with{" "}
            <code className="text-sm text-gray-800 dark:text-gray-300">backend/.env</code> filled to preload the demo account.
          </p>
        </div>

        {message && (
          <p
            className={`rounded-lg p-3 text-sm ${
              message.type === "success"
                ? "bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-200"
                : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200"
            }`}
          >
            {message.text}
          </p>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">API keys</h2>
            <button
              type="button"
              onClick={openAdd}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Add API key
            </button>
          </div>

          {loading ? (
            <p className="text-gray-500 dark:text-gray-400">Loading keys...</p>
          ) : apiKeys.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">
              No API keys yet. Add keys here or seed them from environment variables for the demo
              user.
            </p>
          ) : (
            <ul className="space-y-3">
              {apiKeys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{key.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {SERVICE_LABELS[key.service as ServiceType] ?? key.service}
                      {key.apiKeyPreview ? ` · Key ${key.apiKeyPreview}` : ""}
                      {key.secretConfigured ? " · Secret set" : ""}
                      {key.service === "alpaca" && key.paperTrading ? " · Paper" : ""}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      Added {new Date(key.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleToggle(key)}
                      className="rounded-lg border px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300"
                    >
                      {key.isActive ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(key)}
                      className="rounded-lg border px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300"
                    >
                      Update
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(key.id)}
                      className="rounded-lg border border-red-300 px-3 py-1 text-sm text-red-600 dark:border-red-800 dark:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Password</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Change your login password.</p>
          <button
            type="button"
            onClick={() => setShowPasswordModal(true)}
            className="mt-4 rounded-lg border px-4 py-2 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300"
          >
            Change password
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {editingId ? "Update API key" : "Add API key"}
            </h3>
            <div className="mt-4 space-y-3">
              <select
                className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                value={form.service}
                onChange={(e) =>
                  setForm({ ...form, service: e.target.value as ServiceType })
                }
                disabled={Boolean(editingId)}
              >
                {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((s) => (
                  <option key={s} value={s}>
                    {SERVICE_LABELS[s]}
                  </option>
                ))}
              </select>
              <input
                className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
                placeholder="Display name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
                placeholder={editingId ? "New API key (leave blank to keep)" : "API key"}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              />
              {(form.service === "alpaca" ||
                form.service === "reddit" ||
                form.service === "alphavantage") && (
                <input
                  className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
                  placeholder={
                    editingId ? "New secret (leave blank to keep)" : "Secret key"
                  }
                  value={form.secretKey}
                  onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
                />
              )}
              {form.service === "alpaca" && (
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.paperTrading}
                    onChange={(e) => setForm({ ...form, paperTrading: e.target.checked })}
                  />
                  Paper trading account
                </label>
              )}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border py-2 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand-500 py-2 text-sm text-white disabled:opacity-50"
                onClick={handleSaveKey}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Change password</h3>
            <div className="mt-4 space-y-3">
              <input
                type="password"
                className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
                placeholder="Current password"
                value={passwordForm.currentPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                }
              />
              <input
                type="password"
                className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
                placeholder="New password (min 8 chars)"
                value={passwordForm.newPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, newPassword: e.target.value })
                }
              />
              <input
                type="password"
                className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
                placeholder="Confirm new password"
                value={passwordForm.confirmPassword}
                onChange={(e) =>
                  setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })
                }
              />
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-lg border py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300"
                onClick={() => setShowPasswordModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand-500 py-2 text-sm text-white"
                onClick={handleChangePassword}
                disabled={saving}
              >
                {saving ? "Saving..." : "Update"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
