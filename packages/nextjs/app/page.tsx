"use client";

import Link from "next/link";
import type { NextPage } from "next";
import {
  ArrowRightIcon,
  BanknotesIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";

const steps = [
  {
    number: "01",
    title: "Check Your Reputation",
    description: "Your on-chain activity across multiple EVM chains determines your creditworthiness and loan terms.",
    href: "/reputation",
    cta: "Calculate Score",
    icon: SparklesIcon,
  },
  {
    number: "02",
    title: "Borrow Without Collateral",
    description: "Submit a loan request. Your reputation sets your amount, duration, and interest rate.",
    href: "/borrow",
    cta: "Borrow Funds",
    icon: BanknotesIcon,
  },
  {
    number: "03",
    title: "Earn Yield by Lending",
    description: "Deposit stablecoins into the liquidity pool and earn proportional interest from borrower repayments.",
    href: "/lend",
    cta: "Start Lending",
    icon: CurrencyDollarIcon,
  },
  {
    number: "04",
    title: "Monitor the Protocol",
    description: "Track pool utilization, active loans, and overall protocol health in real time.",
    href: "/stats",
    cta: "View Stats",
    icon: ChartBarIcon,
  },
] as const;

const Home: NextPage = () => {
  return (
    <div className="relative flex flex-col flex-1 overflow-hidden">
      {/* Soft radial gradients */}
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(190,205,103,0.18),transparent_55%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_80%_40%,rgba(143,193,217,0.12),transparent_55%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 opacity-[0.06] dark:opacity-[0.08] [background-image:linear-gradient(to_right,rgba(29,56,20,0.35)_1px,transparent_1px),linear-gradient(to_bottom,rgba(29,56,20,0.35)_1px,transparent_1px)] dark:[background-image:linear-gradient(to_right,rgba(232,234,223,0.2)_1px,transparent_1px),linear-gradient(to_bottom,rgba(232,234,223,0.2)_1px,transparent_1px)] [background-size:72px_72px]"
        aria-hidden="true"
      />

      {/* Floating orbs */}
      <div
        className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(190,205,103,0.9),rgba(105,119,51,0.15),transparent_60%)] blur-2xl opacity-50 animate-orb motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div
        className="absolute top-24 -right-20 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(143,193,217,0.75),rgba(45,91,111,0.12),transparent_60%)] blur-2xl opacity-40 animate-orb motion-reduce:animate-none"
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center flex-1 px-6 sm:px-8 py-12 sm:py-16">
        {/* Hero */}
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-[clamp(2.25rem,5vw,4rem)] font-bold tracking-[-0.03em] text-base-content leading-[1.08]">
            Welcome to <span className="text-primary">Unlloo</span>
          </h1>
          <p className="mt-4 text-[clamp(1.05rem,2vw,1.35rem)] leading-relaxed tracking-tight text-base-content/70 max-w-xl mx-auto">
            Borrow without collateral. Lend and earn yield. All backed by your on-chain reputation.
          </p>
        </div>

        {/* Steps */}
        <div className="mt-12 sm:mt-16 w-full max-w-2xl mx-auto flex flex-col gap-4">
          {steps.map(step => {
            const Icon = step.icon;
            return (
              <Link
                key={step.number}
                href={step.href}
                className="group flex items-start gap-4 sm:gap-5 rounded-2xl border border-base-content/[0.06] bg-base-100/60 backdrop-blur-sm px-5 sm:px-6 py-5 transition-all duration-200 hover:border-primary/30 hover:bg-base-100/80 hover:shadow-[0_8px_40px_rgba(105,119,51,0.08)]"
              >
                <span className="shrink-0 flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 text-primary font-bold text-sm">
                  {step.number}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className="h-[18px] w-[18px] text-primary shrink-0" />
                    <h2 className="text-[15px] sm:text-base font-semibold text-base-content tracking-tight">
                      {step.title}
                    </h2>
                  </div>
                  <p className="mt-1 text-[13px] sm:text-sm leading-relaxed text-base-content/60">{step.description}</p>
                </div>

                <span className="shrink-0 self-center flex items-center gap-1 text-xs font-semibold text-primary opacity-0 translate-x-[-4px] transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0">
                  {step.cta}
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Home;
