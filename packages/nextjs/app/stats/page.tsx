"use client";

import type { NextPage } from "next";
import {
  ArrowTrendingUpIcon,
  BanknotesIcon,
  ChartBarIcon,
  ChartPieIcon,
  CheckBadgeIcon,
  CheckCircleIcon,
  ClockIcon,
  CurrencyDollarIcon,
  DocumentCheckIcon,
  SparklesIcon,
  StarIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { StatsCard } from "~~/components/unlloo";
import { useHomepageStats } from "~~/hooks/unlloo";

const StatsPage: NextPage = () => {
  const {
    totalValueLocked,
    totalBorrowed,
    utilizationRate,
    activeLenders,
    averageAPY,
    pendingLoanRequests,
    activeLoansCount,
    totalLoansCreated,
    repaidLoansCount,
    totalAmountRepaid,
    successRate,
    protocolFeesEarned,
    isLoading,
  } = useHomepageStats();

  return (
    <div className="min-h-screen py-8">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Page Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-base-content mb-3">Protocol Statistics</h1>
          <p className="text-base-content/60 text-lg max-w-xl mx-auto">
            Real-time metrics and performance data from the Unlloo protocol
          </p>
        </div>

        {/* Stats Sections */}
        <div className="space-y-10">
          {/* Liquidity Overview */}
          <section className="stats-section">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-1.5 h-5 rounded-full bg-primary"></div>
              <h3 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">Liquidity Overview</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatsCard
                title="Total Value Locked"
                value={isLoading ? "..." : `$${totalValueLocked}`}
                subtitle="Total deposits in pool"
                icon={<ChartBarIcon className="h-6 w-6" />}
              />
              <StatsCard
                title="Total Borrowed"
                value={isLoading ? "..." : `$${totalBorrowed}`}
                subtitle="Outstanding loans"
                icon={<BanknotesIcon className="h-6 w-6" />}
              />
              <StatsCard
                title="Pool Utilization"
                value={isLoading ? "..." : `${utilizationRate}%`}
                subtitle="Borrowed / TVL ratio"
                icon={<ChartPieIcon className="h-6 w-6" />}
              />
            </div>
          </section>

          {/* Loan Activity */}
          <section className="stats-section">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-1.5 h-5 rounded-full bg-info"></div>
              <h3 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">Loan Activity</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatsCard
                title="Total Loans Created"
                value={isLoading ? "..." : totalLoansCreated.toString()}
                subtitle="All-time loan requests"
                icon={<DocumentCheckIcon className="h-6 w-6" />}
              />
              <StatsCard
                title="Active Loans"
                value={isLoading ? "..." : activeLoansCount.toString()}
                subtitle="Currently being repaid"
                icon={<ArrowTrendingUpIcon className="h-6 w-6" />}
              />
              <StatsCard
                title="Pending Requests"
                value={isLoading ? "..." : pendingLoanRequests.toString()}
                subtitle="Awaiting approval"
                icon={<ClockIcon className="h-6 w-6" />}
              />
            </div>
          </section>

          {/* Repayment Performance */}
          <section className="stats-section">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-1.5 h-5 rounded-full bg-success"></div>
              <h3 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">
                Repayment Performance
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatsCard
                title="Loans Repaid"
                value={isLoading ? "..." : repaidLoansCount.toString()}
                subtitle="Successfully completed"
                icon={<CheckCircleIcon className="h-6 w-6" />}
              />
              <StatsCard
                title="Total Amount Repaid"
                value={isLoading ? "..." : `$${totalAmountRepaid}`}
                subtitle="Principal + interest"
                icon={<CheckBadgeIcon className="h-6 w-6" />}
              />
              <StatsCard
                title="Success Rate"
                value={isLoading ? "..." : `${successRate}%`}
                subtitle="Repaid vs defaulted"
                icon={<StarIcon className="h-6 w-6" />}
              />
            </div>
          </section>

          {/* Lender & Protocol */}
          <section className="stats-section">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-1.5 h-5 rounded-full bg-warning"></div>
              <h3 className="text-sm font-semibold text-base-content/70 uppercase tracking-wide">Lender & Protocol</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatsCard
                title="Active Lenders"
                value={isLoading ? "..." : activeLenders.toString()}
                subtitle="Contributing liquidity"
                icon={<UserGroupIcon className="h-6 w-6" />}
              />
              <StatsCard
                title="Current APY"
                value={isLoading ? "..." : `${averageAPY}%`}
                subtitle="Lender earnings rate"
                icon={<CurrencyDollarIcon className="h-6 w-6" />}
              />
              <StatsCard
                title="Protocol Fees Earned"
                value={isLoading ? "..." : `$${protocolFeesEarned}`}
                subtitle="Revenue generated"
                icon={<SparklesIcon className="h-6 w-6" />}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default StatsPage;
