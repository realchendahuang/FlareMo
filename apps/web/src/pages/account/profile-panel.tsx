import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { TranslationKey } from "@/i18n";

type ProfilePanelProps = {
  error: string | null;
  isPending: boolean;
  setUsername: (value: string) => void;
  t: (key: TranslationKey) => string;
  username: string;
  onSubmit: () => Promise<void>;
};

export function ProfilePanel({
  error,
  isPending,
  setUsername,
  t,
  username,
  onSubmit,
}: ProfilePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.profileTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          <label
            className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium"
            htmlFor="account-username"
          >
            {t("auth.usernameHandle")}
            <Input
              autoCapitalize="none"
              autoComplete="username"
              disabled={isPending}
              id="account-username"
              maxLength={30}
              minLength={3}
              pattern="[A-Za-z0-9_]+"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <Button disabled={isPending} type="submit">
            {isPending ? t("auth.saving") : t("auth.saveUsername")}
          </Button>
        </form>
        {error && (
          <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
