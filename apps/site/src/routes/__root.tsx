import { Outlet, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { name: "theme-color", content: "#17191d" },
      { name: "color-scheme", content: "light dark" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/brand/flaremo-mark-light-300.png" },
      { rel: "apple-touch-icon", href: "/brand/flaremo-app-icon-180.png" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased">
      <Outlet />
    </div>
  );
}