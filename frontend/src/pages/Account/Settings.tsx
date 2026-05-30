import { useState, useEffect, useCallback } from "react";
import PageMeta from "../../components/common/PageMeta";
import { tradingService, type RiskSettings } from "../../services/tradingService";
import { userApiService, type UserSettings } from "../../services/userApiService";
import { useTheme } from "../../context/ThemeContext";
import type { ThemePreference } from "../../utils/themePreference";

type SettingsForm = Pick<
  UserSettings,
  | "theme"
  | "timezone"
  | "currency"
  | "dateFormat"
  | "emailNotifications"
  | "tradingAlerts"
  | "confirmOrders"
  | "riskWarnings"
>;

const DEFAULTS: SettingsForm = {
  theme: "system",
  timezone: "UTC",
  currency: "USD",
  dateFormat: "MM/DD/YYYY",
  emailNotifications: true,
  tradingAlerts: true,
  confirmOrders: true,
  riskWarnings: true,
};

const DEFAULT_RISK: RiskSettings = {
  maxPositionSizePercent: 20,
  dailyLossLimit: 2000,
  perTradeRiskPercent: 2,
};

export default function Settings() {
  const { setThemePreference } = useTheme();
  const [settings, setSettings] = useState<SettingsForm>(DEFAULTS);
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(DEFAULT_RISK);
  const [initialSettings, setInitialSettings] = useState<SettingsForm | null>(null);
  const [initialRisk, setInitialRisk] = useState<RiskSettings | null>(null);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    setIsLoadingPage(true);
    setMessage(null);
    try {
      const [userSettings, risk] = await Promise.all([
        userApiService.getSettings(),
        tradingService.getRiskSettings().catch(() => DEFAULT_RISK),
      ]);

      const form: SettingsForm = {
        theme: userSettings.theme || "system",
        timezone: userSettings.timezone || "UTC",
        currency: userSettings.currency || "USD",
        dateFormat: userSettings.dateFormat || "MM/DD/YYYY",
        emailNotifications: userSettings.emailNotifications,
        tradingAlerts: userSettings.tradingAlerts,
        confirmOrders: userSettings.confirmOrders,
        riskWarnings: userSettings.riskWarnings,
      };

      setSettings(form);
      setInitialSettings(form);
      setRiskSettings(risk);
      setInitialRisk(risk);

      const pref = (form.theme === "dark" || form.theme === "system" ? form.theme : "light") as ThemePreference;
      setThemePreference(pref);
    } catch {
      setMessage({ type: "error", text: "Could not load settings. Check that you are signed in." });
    } finally {
      setIsLoadingPage(false);
    }
  }, [setThemePreference]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const hasChanges =
    initialSettings !== null &&
    initialRisk !== null &&
    (JSON.stringify(settings) !== JSON.stringify(initialSettings) ||
      JSON.stringify(riskSettings) !== JSON.stringify(initialRisk));

  const patchSettings = (patch: Partial<SettingsForm>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      await userApiService.updateSettings(settings);

      const pref = (settings.theme === "dark" || settings.theme === "system"
        ? settings.theme
        : "light") as ThemePreference;
      setThemePreference(pref);

      try {
        const updatedRisk = await tradingService.updateRiskSettings(riskSettings);
        setRiskSettings(updatedRisk);
        setInitialRisk(updatedRisk);
      } catch (riskErr) {
        const text =
          riskErr instanceof Error
            ? riskErr.message
            : "Preferences saved, but risk limits could not be updated. Initialize trading first.";
        setMessage({ type: "error", text });
        setInitialSettings(settings);
        return;
      }

      setInitialSettings(settings);
      setMessage({ type: "success", text: "Settings saved." });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "Failed to save settings.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    if (initialSettings) setSettings(initialSettings);
    if (initialRisk) setRiskSettings(initialRisk);
    if (initialSettings) {
      const pref = (initialSettings.theme === "dark" || initialSettings.theme === "system"
        ? initialSettings.theme
        : "light") as ThemePreference;
      setThemePreference(pref);
    }
  };

  const SettingSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <h3 className="mb-5 text-lg font-medium text-gray-900 dark:text-white">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  );

  const ToggleSetting = ({
    label,
    description,
    value,
    onChange,
  }: {
    label: string;
    description?: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-900 dark:text-white">{label}</div>
        {description && (
          <div className="text-sm text-gray-500 dark:text-gray-400">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
          value ? "bg-brand-500" : "bg-gray-200 dark:bg-gray-700"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
            value ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );

  const SelectSetting = ({
    label,
    description,
    value,
    options,
    onChange,
  }: {
    label: string;
    description?: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-white">{label}</label>
      {description && (
        <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-brand-300 focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  const NumberSetting = ({
    label,
    description,
    value,
    min,
    max,
    step,
    unit,
    onChange,
  }: {
    label: string;
    description?: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    onChange: (value: number) => void;
  }) => (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-900 dark:text-white">{label}</label>
      {description && (
        <p className="mb-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      )}
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-brand-300 focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        />
        {unit && <span className="text-sm text-gray-500 dark:text-gray-400">{unit}</span>}
      </div>
    </div>
  );

  if (isLoadingPage) {
    return (
      <>
        <PageMeta title="Settings | Inwest App" description="Application preferences" />
        <p className="text-gray-500 dark:text-gray-400">Loading settings…</p>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Settings | Inwest App" description="Application preferences" />

      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
            <p className="mt-1 text-gray-600 dark:text-gray-400">
              Mockup page - mostly doesn't work.
            </p>
          </div>

          {hasChanges && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDiscard}
                disabled={isSaving}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
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

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SettingSection title="Appearance">
            <SelectSetting
              label="Theme"
              description="Also toggled from the header sun/moon control (saves as light or dark)."
              value={settings.theme}
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
              onChange={(value) => {
                patchSettings({ theme: value });
                const pref = (value === "dark" || value === "system" ? value : "light") as ThemePreference;
                setThemePreference(pref);
              }}
            />
          </SettingSection>

          <SettingSection title="Regional">
            <SelectSetting
              label="Timezone"
              description="Used for dates on your profile and reports."
              value={settings.timezone}
              options={[
                { value: "Europe/Warsaw", label: "Europe/Warsaw" },
                { value: "UTC", label: "UTC" },
                { value: "Europe/London", label: "Europe/London" },
                { value: "America/New_York", label: "America/New_York" },
                { value: "America/Los_Angeles", label: "America/Los_Angeles" },
              ]}
              onChange={(value) => patchSettings({ timezone: value })}
            />
            <SelectSetting
              label="Currency"
              value={settings.currency}
              options={[
                { value: "USD", label: "USD" },
                { value: "EUR", label: "EUR" },
                { value: "PLN", label: "PLN" },
              ]}
              onChange={(value) => patchSettings({ currency: value })}
            />
            <SelectSetting
              label="Date format"
              value={settings.dateFormat}
              options={[
                { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
                { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
                { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
              ]}
              onChange={(value) => patchSettings({ dateFormat: value })}
            />
          </SettingSection>

          <SettingSection title="Trading">
            <ToggleSetting
              label="Confirm orders"
              description="Ask for confirmation before sending an order from the trading form."
              value={settings.confirmOrders}
              onChange={(value) => patchSettings({ confirmOrders: value })}
            />
            <ToggleSetting
              label="Risk warnings"
              description="Show an extra warning on the order form before you submit."
              value={settings.riskWarnings}
              onChange={(value) => patchSettings({ riskWarnings: value })}
            />
            <NumberSetting
              label="Max position size"
              description="Largest single position as % of portfolio (enforced by the server)."
              value={riskSettings.maxPositionSizePercent}
              min={1}
              max={100}
              unit="%"
              onChange={(value) => setRiskSettings((prev) => ({ ...prev, maxPositionSizePercent: value }))}
            />
            <NumberSetting
              label="Daily loss limit"
              description="Block new orders after this realized daily loss."
              value={riskSettings.dailyLossLimit}
              min={100}
              max={100000}
              unit="USD"
              onChange={(value) => setRiskSettings((prev) => ({ ...prev, dailyLossLimit: value }))}
            />
            <NumberSetting
              label="Per-trade risk"
              description="Max estimated loss per trade as % of portfolio (buy orders need a stop price)."
              value={riskSettings.perTradeRiskPercent}
              min={0.1}
              max={50}
              step={0.1}
              unit="%"
              onChange={(value) => setRiskSettings((prev) => ({ ...prev, perTradeRiskPercent: value }))}
            />
          </SettingSection>

          <SettingSection title="Notifications">
            <p className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
              Stored for your account; delivery depends on email integration being configured on the server.
            </p>
            <ToggleSetting
              label="Email notifications"
              description="Important account and trading updates by email."
              value={settings.emailNotifications}
              onChange={(value) => patchSettings({ emailNotifications: value })}
            />
            <ToggleSetting
              label="Trading alerts"
              description="Alerts related to trading activity."
              value={settings.tradingAlerts}
              onChange={(value) => patchSettings({ tradingAlerts: value })}
            />
          </SettingSection>
        </div>
      </div>
    </>
  );
}
