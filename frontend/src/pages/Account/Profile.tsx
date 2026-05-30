import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import { useAuth } from "../../context/AuthContext";
import { userApiService, type UserProfile } from "../../services/userApiService";

export default function Profile() {
  const { user: authUser } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    timezone: "Europe/Warsaw",
    language: "en",
  });

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setMessage(null);
    try {
      const data = await userApiService.getProfile();
      setProfile(data);
      setForm({
        firstName: data.firstName,
        lastName: data.lastName,
        timezone: data.timezone,
        language: data.language,
      });
    } catch (e) {
      if (authUser) {
        setProfile({
          id: authUser.id,
          email: authUser.email,
          firstName: authUser.firstName,
          lastName: authUser.lastName,
          timezone: "Europe/Warsaw",
          language: "en",
          emailVerified: true,
          dateJoined: new Date().toISOString(),
        });
        setForm({
          firstName: authUser.firstName,
          lastName: authUser.lastName,
          timezone: "Europe/Warsaw",
          language: "en",
        });
      }
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "Failed to load profile",
      });
    } finally {
      setIsLoading(false);
    }
  }, [authUser]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const updated = await userApiService.updateProfile(form);
      setProfile(updated);
      setIsEditing(false);
      setMessage({ type: "success", text: "Profile updated successfully." });
    } catch (e) {
      setMessage({
        type: "error",
        text: e instanceof Error ? e.message : "Failed to update profile",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  if (isLoading && !profile) {
    return (
      <>
        <PageMeta title="Profile | Inwest App" description="Your account profile" />
        <p className="text-gray-500 dark:text-gray-400">Loading profile...</p>
      </>
    );
  }

  const display = profile ?? {
    id: authUser?.id ?? "",
    email: authUser?.email ?? "",
    firstName: form.firstName,
    lastName: form.lastName,
    timezone: form.timezone,
    language: form.language,
    emailVerified: true,
    dateJoined: new Date().toISOString(),
  };

  return (
    <>
      <PageMeta title="Profile | Inwest App" description="Manage your profile" />

      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profile</h1>
            <p className="mt-1 text-gray-600 dark:text-gray-400">
              Your account details from the database
            </p>
          </div>
          {!isEditing && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Edit profile
            </button>
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

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900 lg:col-span-1">
            <div className="text-center">
              <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-brand-500/10 text-2xl font-bold text-brand-600">
                {display.firstName.charAt(0)}
                {display.lastName.charAt(0)}
              </div>
              <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                {display.firstName} {display.lastName}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{display.email}</p>
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Member since {formatDate(display.dateJoined)}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900 lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  First name
                </label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white disabled:opacity-60"
                  value={isEditing ? form.firstName : display.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  disabled={!isEditing}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Last name
                </label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white disabled:opacity-60"
                  value={isEditing ? form.lastName : display.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  disabled={!isEditing}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Email
                </label>
                <input
                  className="w-full rounded-lg border bg-gray-50 px-3 py-2 text-gray-600 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
                  value={display.email}
                  disabled
                  title="Change email via support or re-register"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Email is tied to your login and shown from the server.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Timezone
                </label>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white disabled:opacity-60"
                  value={isEditing ? form.timezone : display.timezone}
                  onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                  disabled={!isEditing}
                >
                  <option value="Europe/Warsaw">Europe/Warsaw</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Language
                </label>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-white disabled:opacity-60"
                  value={isEditing ? form.language : display.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  disabled={!isEditing}
                >
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            {isEditing && (
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    if (profile) {
                      setForm({
                        firstName: profile.firstName,
                        lastName: profile.lastName,
                        timezone: profile.timezone,
                        language: profile.language,
                      });
                    }
                  }}
                  className="rounded-lg border px-4 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
