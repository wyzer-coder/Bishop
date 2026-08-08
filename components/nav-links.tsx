"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  Coins,
  Thermometer,
  Receipt,
  Radio,
  Network,
  FileCode,
  MapPin,
  HeartHandshake,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/protocol", label: "Protocol", icon: Network },
  { href: "/map", label: "Map", icon: MapPin },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/transfers", label: "Transfers", icon: ArrowLeftRight },
  { href: "/credits", label: "Credits", icon: Coins },
  { href: "/family", label: "Family Credits", icon: HeartHandshake },
  { href: "/coldchain", label: "Cold Chain", icon: Thermometer },
  { href: "/billing", label: "Billing", icon: Receipt },
  { href: "/simulator", label: "Simulator", icon: Radio },
  { href: "/docs", label: "Docs", icon: FileCode },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-accent"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
