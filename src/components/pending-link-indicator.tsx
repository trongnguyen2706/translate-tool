"use client";

import { LoaderCircle } from "lucide-react";
import { useLinkStatus } from "next/link";

export function PendingLinkIndicator() {
  const { pending } = useLinkStatus();
  return <LoaderCircle size={15} className={`nav-pending-icon ${pending ? "spin visible" : ""}`} aria-hidden="true" />;
}
