import { UserButton } from "@clerk/nextjs";
import { NavLinks } from "@/components/nav-links";
import { ScannerLocationBar } from "@/components/scanner-location-bar";
import { ScanWatcher } from "@/components/scan-watcher";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="px-4 py-4">
          <span className="text-sm font-semibold tracking-tight text-primary">
            BishopOS
          </span>
        </div>
        <NavLinks />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <ScannerLocationBar />
          <UserButton />
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
      <ScanWatcher />
    </div>
  );
}
