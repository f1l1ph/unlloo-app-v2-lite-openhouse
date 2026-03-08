"use client";

import type { NextPage } from "next";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import { ErrorBoundary } from "~~/components/ErrorBoundary";
import { GuarantorDashboard } from "~~/components/unlloo/guarantor/GuarantorDashboard";

const GuarantorPage: NextPage = () => {
  return (
    <ErrorBoundary>
      <GuarantorDashboard />
    </ErrorBoundary>
  );
};
export default GuarantorPage;
