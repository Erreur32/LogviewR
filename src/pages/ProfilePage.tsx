import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  Globe,
  User as UserIcon,
  Mail,
  Key,
  Eye,
  EyeOff,
  Save,
  AlertCircle,
  Loader2,
  Edit2,
} from 'lucide-react';
import { api } from '../api/client';
import { useUserAuthStore } from '../stores/userAuthStore';
import { Section, SettingRow } from '../components/SettingsSection';
import { UserMenu } from '../components/ui';
import { useTranslation } from 'react-i18next';
import { setAppLanguage, getAppLanguage } from '../i18n';

interface ProfilePageProps {
  onBack: () => void;
  onLogout?: () => void;
  onSettingsClick?: () => void;
  onAdminClick?: () => void;
  onUsersClick?: () => void;
}

const PRESET_TIMEZONES = [
  'Europe/Paris', 'Europe/London', 'UTC',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney',
];

export const ProfilePage: React.FC<ProfilePageProps> = ({ onBack, onLogout, onSettingsClick, onAdminClick, onUsersClick }) => {
  const { t } = useTranslation();
  const { user: currentUser, checkAuth } = useUserAuthStore();

  // ── Profile state ────────────────────────────────────────────────────────
  const [username, setUsername]                   = useState('');
  const [email, setEmail]                         = useState('');
  const [oldPassword, setOldPassword]             = useState('');
  const [newPassword, setNewPassword]             = useState('');
  const [confirmPassword, setConfirmPassword]     = useState('');
  const [isSaving, setIsSaving]                   = useState(false);
  const [error, setError]                         = useState<string | null>(null);
  const [successMessage, setSuccessMessage]       = useState<string | null>(null);
  const [showPasswordFields, setShowPasswordFields] = useState(false);
  const [showOldPassword, setShowOldPassword]     = useState(false);
  const [showNewPassword, setShowNewPassword]     = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailError, setEmailError]               = useState<string | null>(null);
  const [avatarFile, setAvatarFile]               = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview]         = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // ── Localization state ───────────────────────────────────────────────────
  const [timezone, setTimezone] = useState('Europe/Paris');
  const [customTz, setCustomTz] = useState('');

  useEffect(() => {
    if (currentUser) {
      setUsername(currentUser.username);
      setEmail(currentUser.email || '');
      setAvatarPreview(currentUser.avatar ?? null);
    }
  }, [currentUser]);

  const validateEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setEmail(v);
    if (!v.trim()) { setEmailError(null); return; }
    setEmailError(validateEmail(v) ? null : 'Format d\'email invalide');
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    setEmailError(null);

    try {
      if (!currentUser?.id) { setError('Vous devez être connecté'); setIsSaving(false); return; }
      if (!username.trim() || username.trim().length < 3) {
        setError('Le nom d\'utilisateur doit contenir au moins 3 caractères'); setIsSaving(false); return;
      }
      if (!/^[\w.\-]+$/.test(username.trim())) {
        setError('Caractères autorisés : lettres, chiffres, point, tiret, underscore'); setIsSaving(false); return;
      }
      if (email !== currentUser.email) {
        if (!email.trim()) { setEmailError('L\'email ne peut pas être vide'); setError('Veuillez corriger les erreurs'); setIsSaving(false); return; }
        if (!validateEmail(email)) { setEmailError('Format d\'email invalide'); setError('Veuillez corriger les erreurs'); setIsSaving(false); return; }
      }
      if (showPasswordFields && newPassword) {
        if (newPassword.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères'); setIsSaving(false); return; }
        if (newPassword !== confirmPassword) { setError('Les mots de passe ne correspondent pas'); setIsSaving(false); return; }
        if (!oldPassword) { setError('Veuillez entrer votre mot de passe actuel'); setIsSaving(false); return; }
      }

      const updateData: Record<string, string> = {};
      if (username !== currentUser.username) updateData.username = username;
      if (email !== currentUser.email && email && validateEmail(email)) updateData.email = email;
      if (showPasswordFields && newPassword && oldPassword) {
        updateData.password = newPassword;
        updateData.oldPassword = oldPassword;
      }
      if (Object.keys(updateData).length === 0) { setError('Aucune modification à sauvegarder'); setIsSaving(false); return; }

      const response = await api.put(`/api/users/${currentUser.id}`, updateData);
      if (response.success) {
        setSuccessMessage('Profil mis à jour avec succès');
        setOldPassword(''); setNewPassword(''); setConfirmPassword('');
        setShowPasswordFields(false);
        await checkAuth();
      } else {
        setError(response.error?.message || 'Échec de la mise à jour');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = async () => {
    if (!currentUser || !avatarFile || isUploadingAvatar) return;
    setIsUploadingAvatar(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const base64String = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
        reader.onloadend = () => {
          if (reader.result && typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Impossible de convertir le fichier en base64'));
        };
        reader.readAsDataURL(avatarFile);
      });
      if (base64String.length > 10 * 1024 * 1024) { setError('L\'image est trop volumineuse'); setIsUploadingAvatar(false); return; }
      const response = await api.put(`/api/users/${currentUser.id}`, { avatar: base64String });
      if (response.success) {
        setSuccessMessage(t('admin.general.profile.avatarUpdatedSuccess'));
        setAvatarFile(null);
        await checkAuth();
      } else {
        setError(response.error?.message || 'Échec de la mise à jour de l\'avatar');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour de l\'avatar');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const initials = (currentUser?.username ?? 'U')
    .split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U';

  return (
    <div className="min-h-screen bg-theme-primary text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0d0d0d]/95 backdrop-blur border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-sm"
        >
          <ChevronLeft size={16} />
          Retour
        </button>
        <div className="flex items-center gap-2 flex-1">
          <UserIcon size={18} className="text-blue-400" />
          <h1 className="text-base font-semibold text-gray-100">Mon Profil</h1>
        </div>
        <UserMenu
          user={currentUser ?? undefined}
          onProfileClick={onBack}
          onSettingsClick={onSettingsClick}
          onAdminClick={onAdminClick}
          onUsersClick={onUsersClick}
          onLogout={onLogout}
        />
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Profile section */}
        <Section title={t('admin.general.myProfile')} icon={UserIcon} iconColor="blue">
          {error && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm flex items-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          {successMessage && (
            <div className="mb-4 p-3 bg-emerald-900/30 border border-emerald-700 rounded-lg text-emerald-400 text-sm flex items-center gap-2">
              <Save size={16} />
              {successMessage}
            </div>
          )}

          {/* Avatar */}
          <SettingRow
            label={t('admin.general.profile.avatar')}
            description={t('admin.general.profile.avatarDescription')}
          >
            <div className="flex items-center gap-4 w-full">
              <div className="relative">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-xl overflow-hidden">
                  {avatarPreview
                    ? <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                    : <span>{initials}</span>
                  }
                </div>
                {avatarFile && (
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#1a1a1a]">
                    <Save size={12} className="text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <label className="block">
                  <input type="file" accept="image/*" className="hidden" onChange={e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setAvatarFile(file);
                    const reader = new FileReader();
                    reader.onloadend = () => setAvatarPreview(reader.result as string);
                    reader.readAsDataURL(file);
                  }} />
                  <span className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm cursor-pointer transition-colors">
                    {t('admin.general.profile.chooseImage')}
                  </span>
                </label>
                {avatarFile && (
                  <button
                    onClick={handleAvatarUpload}
                    disabled={isUploadingAvatar}
                    className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                  >
                    {isUploadingAvatar
                      ? <><Loader2 size={16} className="animate-spin" /><span>{t('admin.general.profile.saving')}</span></>
                      : <span>{t('admin.general.profile.saveAvatar')}</span>
                    }
                  </button>
                )}
              </div>
            </div>
          </SettingRow>

          {/* Username */}
          <SettingRow label={t('admin.general.profile.username')} description={t('admin.general.profile.usernameDescription')}>
            <div className="flex items-center gap-3 w-full">
              <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 flex-shrink-0">
                <UserIcon size={18} className="text-blue-400" />
              </div>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className={`flex-1 px-3 py-2 bg-[#1a1a1a] border rounded-lg text-white text-sm focus:outline-none transition-colors ${
                  username.trim() && (username.trim().length < 3 || !/^[\w.\-]+$/.test(username.trim()))
                    ? 'border-red-500 focus:border-red-400'
                    : 'border-gray-700 focus:border-blue-500'
                }`}
                placeholder={t('admin.general.profile.usernamePlaceholder')}
              />
            </div>
          </SettingRow>

          {/* Email */}
          <SettingRow label={t('admin.general.profile.email')} description={t('admin.general.profile.emailDescription')}>
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-3 w-full">
                <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/20 flex-shrink-0">
                  <Mail size={18} className="text-purple-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={handleEmailChange}
                  className={`flex-1 px-3 py-2 bg-[#1a1a1a] border rounded-lg text-white text-sm focus:outline-none transition-colors ${
                    emailError ? 'border-red-500 focus:border-red-500' : 'border-gray-700 focus:border-purple-500'
                  }`}
                  placeholder={t('admin.general.profile.emailPlaceholder')}
                />
              </div>
              {emailError && <p className="text-xs text-red-400 ml-12">{emailError}</p>}
            </div>
          </SettingRow>

          {/* Password */}
          <SettingRow
            label={t('admin.general.profile.password')}
            description={showPasswordFields ? t('admin.general.profile.passwordEdit') : t('admin.general.profile.passwordClickToEdit')}
          >
            <div className="flex flex-col gap-3 w-full">
              {!showPasswordFields ? (
                <button
                  onClick={() => setShowPasswordFields(true)}
                  className="flex items-center gap-3 px-4 py-3 bg-[#1a1a1a] hover:bg-[#252525] border border-gray-700 rounded-lg text-white text-sm transition-colors group"
                >
                  <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20 group-hover:bg-amber-500/20 transition-colors">
                    <Key size={18} className="text-amber-400" />
                  </div>
                  <span className="flex-1 text-left">{t('admin.general.profile.editPassword')}</span>
                  <Edit2 size={16} className="text-gray-400 group-hover:text-amber-400 transition-colors" />
                </button>
              ) : (
                <>
                  {[
                    { val: oldPassword, set: setOldPassword, show: showOldPassword, setShow: setShowOldPassword, placeholder: t('admin.general.profile.currentPasswordPlaceholder'), color: 'amber' },
                    { val: newPassword, set: setNewPassword, show: showNewPassword, setShow: setShowNewPassword, placeholder: t('admin.general.profile.newPasswordPlaceholder'), color: 'emerald' },
                    { val: confirmPassword, set: setConfirmPassword, show: showConfirmPassword, setShow: setShowConfirmPassword, placeholder: t('admin.general.profile.confirmPasswordPlaceholder'), color: 'emerald' },
                  ].map(({ val, set, show, setShow, placeholder, color }) => (
                    <div key={placeholder} className="flex items-center gap-3 w-full">
                      <div className={`p-2 bg-${color}-500/10 rounded-lg border border-${color}-500/20 flex-shrink-0`}>
                        <Key size={18} className={`text-${color}-400`} />
                      </div>
                      <input
                        type={show ? 'text' : 'password'}
                        placeholder={placeholder}
                        value={val}
                        onChange={e => set(e.target.value)}
                        className={`flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-${color}-500 transition-colors`}
                      />
                      <button type="button" onClick={() => setShow(!show)} className={`p-2 text-gray-400 hover:text-${color}-400 transition-colors`}>
                        {show ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <Save size={16} />
                      {isSaving ? t('admin.general.profile.saving') : t('admin.general.profile.save')}
                    </button>
                    <button
                      onClick={() => { setShowPasswordFields(false); setOldPassword(''); setNewPassword(''); setConfirmPassword(''); setError(null); }}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm transition-colors"
                    >
                      {t('admin.general.profile.cancel')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </SettingRow>

          {!showPasswordFields && (
            <div className="flex justify-end pt-4">
              <button
                onClick={handleSave}
                disabled={isSaving || (email === currentUser?.email && username === currentUser?.username) || !!emailError}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
              >
                <Save size={18} />
                {isSaving ? t('admin.general.profile.saving') : t('admin.general.profile.saveChanges')}
              </button>
            </div>
          )}
        </Section>

        {/* Localization section */}
        <Section title={t('admin.general.localization')} icon={Globe} iconColor="cyan">
          <SettingRow label={t('admin.general.timezone')} description={t('admin.general.timezoneDescription')}>
            <div className="flex flex-col gap-1.5 items-end">
              <select
                value={timezone === '__custom__' ? '__custom__' : (PRESET_TIMEZONES.includes(timezone) ? timezone : '__custom__')}
                onChange={e => {
                  if (e.target.value === '__custom__') { setTimezone('__custom__'); }
                  else { setTimezone(e.target.value); setCustomTz(''); }
                }}
                className="px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm"
              >
                {PRESET_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                <option value="__custom__">Autre…</option>
              </select>
              {(timezone === '__custom__' || !PRESET_TIMEZONES.includes(timezone)) && (
                <input
                  type="text"
                  value={customTz}
                  onChange={e => { setCustomTz(e.target.value); setTimezone(e.target.value || '__custom__'); }}
                  placeholder="ex: America/Toronto"
                  className="px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 w-48 font-mono"
                />
              )}
            </div>
          </SettingRow>

          <SettingRow label={t('admin.general.languageLabel')} description={t('admin.general.languageDescription')}>
            <div className="flex gap-2">
              {([
                { value: 'fr', label: 'Français', flag: '/icons/country/fr.svg' },
                { value: 'en', label: 'English',  flag: '/icons/country/gb.svg' },
              ] as const).map(({ value, label, flag }) => {
                const isActive = getAppLanguage() === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAppLanguage(value)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all"
                    style={{
                      borderColor: isActive ? '#22d3ee' : '#374151',
                      background:  isActive ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.03)',
                      color:       isActive ? '#22d3ee' : '#9ca3af',
                      boxShadow:   isActive ? '0 0 0 1px rgba(34,211,238,0.3)' : undefined,
                    }}
                  >
                    <img src={flag} alt={value} style={{ width: 18, height: 13, objectFit: 'cover', borderRadius: 2 }} />
                    {label}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        </Section>

      </div>
    </div>
  );
};

export default ProfilePage;
