/**
 * The account settings panel: it owns the 62-prop surface its caller wires up
 * and distributes it to the profile, credentials, token and danger-zone
 * sections, which hold the dialog state and the markup. The prop surface and
 * the exported constants are unchanged from before the split.
 */

import type { UseQueryResult } from "@tanstack/react-query";
import type { PersonalAccessToken } from "@/api";
import type { TranslationKey, TranslationParams } from "@/i18n";
import {
  AccountCredentialsSection,
  DeleteAccountSection,
} from "./account-credentials-section";
import { AccountProfileSection } from "./account-profile-section";
import { AccountTokensSection } from "./account-tokens-section";
import { SettingsSectionGroup } from "./apple-settings-ui";

export { MIN_PASSWORD_LENGTH } from "./account-panel-presets";

export type AccountPanelProps = {
  // Avatar & Profile
  currentAvatarUrl?: string | null;
  currentName?: string;
  name: string;
  nameError: string | null;
  setName: (value: string) => void;
  onNameSubmit: () => Promise<void>;
  updateNameIsPending: boolean;

  avatarError: string | null;
  avatarIsPending: boolean;
  onAvatarUpload: (file: File) => Promise<void>;
  onAvatarUrlSubmit: (url: string) => Promise<void>;
  onAvatarDelete: () => Promise<void>;

  // Username
  currentUsername: string;
  accountError: string | null;
  updateUsernameIsPending: boolean;
  readerExpiry?: string | null;
  setUsername: (value: string) => void;
  username: string;
  onUsernameSubmit: () => Promise<void>;

  // Email & Password & Delete
  changeEmailIsPending: boolean;
  changePasswordIsPending: boolean;
  currentEmail: string;
  emailProviderDisabled?: boolean;
  currentPassword: string;
  deleteAccountIsPending: boolean;
  deleteError: string | null;
  deletePassword: string;
  emailCurrentPassword: string;
  emailError: string | null;
  emailVerificationPending: boolean;
  isOwner: boolean;
  newPassword: string;
  newPasswordConfirmation: string;
  passwordError: string | null;
  setCurrentPassword: (value: string) => void;
  setDeletePassword: (value: string) => void;
  setEmailCurrentPassword: (value: string) => void;
  setNewEmail: (value: string) => void;
  setNewPassword: (value: string) => void;
  setNewPasswordConfirmation: (value: string) => void;
  newEmail: string;
  onEmailSubmit: () => Promise<void>;
  onPasswordSubmit: () => Promise<void>;
  onDeleteAccount: () => Promise<boolean>;

  // Personal Access Tokens
  copied: boolean;
  createTokenIsPending: boolean;
  createdToken: string | null;
  deletingTokenId: string | undefined;
  locale: string;
  revokingTokenId: string | undefined;
  setTokenExpiryDays: (value: string) => void;
  setTokenName: (value: string) => void;
  tokenError: string | null;
  tokenExpiryDays: string;
  tokenName: string;
  tokensQuery: UseQueryResult<
    { personal_access_tokens: PersonalAccessToken[] },
    Error
  >;
  onCopyToken: () => Promise<void>;
  onCreateToken: () => Promise<void>;
  onRevokeToken: (id: string) => Promise<void>;
  onDeleteToken: (id: string) => Promise<void>;
  onHideCreatedToken: () => void;

  // i18n
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

export function AccountPanel({
  currentAvatarUrl,
  currentName,
  name,
  nameError,
  setName,
  onNameSubmit,
  updateNameIsPending,

  avatarError,
  avatarIsPending,
  onAvatarUpload,
  onAvatarUrlSubmit,
  onAvatarDelete,

  currentUsername,
  accountError,
  updateUsernameIsPending,
  readerExpiry,
  setUsername,
  username,
  onUsernameSubmit,

  changeEmailIsPending,
  changePasswordIsPending,
  currentEmail,
  emailProviderDisabled,
  currentPassword,
  deleteAccountIsPending,
  deleteError,
  deletePassword,
  emailCurrentPassword,
  emailError,
  emailVerificationPending,
  isOwner,
  newPassword,
  newPasswordConfirmation,
  passwordError,
  setCurrentPassword,
  setDeletePassword,
  setEmailCurrentPassword,
  setNewEmail,
  setNewPassword,
  setNewPasswordConfirmation,
  newEmail,
  onEmailSubmit,
  onPasswordSubmit,
  onDeleteAccount,

  copied,
  createTokenIsPending,
  createdToken,
  deletingTokenId,
  locale,
  revokingTokenId,
  setTokenExpiryDays,
  setTokenName,
  tokenError,
  tokenExpiryDays,
  tokenName,
  tokensQuery,
  onCopyToken,
  onCreateToken,
  onRevokeToken,
  onDeleteToken,
  onHideCreatedToken,

  t,
}: AccountPanelProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* 1. Account & Credentials */}
      <SettingsSectionGroup>
        <AccountProfileSection
          accountError={accountError}
          avatarError={avatarError}
          avatarIsPending={avatarIsPending}
          currentAvatarUrl={currentAvatarUrl}
          currentName={currentName}
          currentUsername={currentUsername}
          name={name}
          nameError={nameError}
          onAvatarDelete={onAvatarDelete}
          onAvatarUpload={onAvatarUpload}
          onAvatarUrlSubmit={onAvatarUrlSubmit}
          onNameSubmit={onNameSubmit}
          onUsernameSubmit={onUsernameSubmit}
          readerExpiry={readerExpiry}
          setName={setName}
          setUsername={setUsername}
          t={t}
          updateNameIsPending={updateNameIsPending}
          updateUsernameIsPending={updateUsernameIsPending}
          username={username}
        />
        <AccountCredentialsSection
          changeEmailIsPending={changeEmailIsPending}
          changePasswordIsPending={changePasswordIsPending}
          currentEmail={currentEmail}
          currentPassword={currentPassword}
          emailCurrentPassword={emailCurrentPassword}
          emailError={emailError}
          emailProviderDisabled={emailProviderDisabled}
          emailVerificationPending={emailVerificationPending}
          newEmail={newEmail}
          newPassword={newPassword}
          newPasswordConfirmation={newPasswordConfirmation}
          onEmailSubmit={onEmailSubmit}
          onPasswordSubmit={onPasswordSubmit}
          passwordError={passwordError}
          setCurrentPassword={setCurrentPassword}
          setEmailCurrentPassword={setEmailCurrentPassword}
          setNewEmail={setNewEmail}
          setNewPassword={setNewPassword}
          setNewPasswordConfirmation={setNewPasswordConfirmation}
          t={t}
        />
      </SettingsSectionGroup>

      {/* 2. Personal Access Tokens */}
      <AccountTokensSection
        copied={copied}
        createTokenIsPending={createTokenIsPending}
        createdToken={createdToken}
        deletingTokenId={deletingTokenId}
        locale={locale}
        onCopyToken={onCopyToken}
        onCreateToken={onCreateToken}
        onDeleteToken={onDeleteToken}
        onHideCreatedToken={onHideCreatedToken}
        onRevokeToken={onRevokeToken}
        revokingTokenId={revokingTokenId}
        setTokenExpiryDays={setTokenExpiryDays}
        setTokenName={setTokenName}
        t={t}
        tokenError={tokenError}
        tokenExpiryDays={tokenExpiryDays}
        tokenName={tokenName}
        tokensQuery={tokensQuery}
      />

      {/* 3. Danger Zone (Non-owner only) */}
      {!isOwner && (
        <DeleteAccountSection
          deleteAccountIsPending={deleteAccountIsPending}
          deleteError={deleteError}
          deletePassword={deletePassword}
          onDeleteAccount={onDeleteAccount}
          setDeletePassword={setDeletePassword}
          t={t}
        />
      )}
    </div>
  );
}
