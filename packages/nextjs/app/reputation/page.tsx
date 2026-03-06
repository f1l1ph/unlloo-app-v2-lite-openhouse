"use client";

import type { NextPage } from "next";
import { ErrorBoundary } from "~~/components/ErrorBoundary";
import { AuthGuard } from "~~/components/unlloo/AuthGuard";
import { ReputationDashboard } from "~~/components/unlloo/reputation/ReputationDashboard";

const Home: NextPage = () => {
  return (
    <AuthGuard>
      <ErrorBoundary>
        <ReputationDashboard />
      </ErrorBoundary>
    </AuthGuard>
  );
};

export default Home;
