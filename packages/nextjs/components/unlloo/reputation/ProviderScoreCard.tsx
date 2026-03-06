import React from "react";
import Image from "next/image";
import { CheckBadgeIcon, ShieldCheckIcon, SparklesIcon, TrophyIcon } from "@heroicons/react/24/outline";

interface ProviderScoreCardProps {
  name: string;
  score: number;
  maxScore: number;
  description: string;
  icon?: "shield" | "check" | "sparkles" | "trophy";
  logo?: string;
  websiteUrl?: string;
  isLoading?: boolean;
  error?: string;
  comingSoon?: boolean;
}

const getIcon = (iconType?: string) => {
  switch (iconType) {
    case "shield":
      return <ShieldCheckIcon className="h-8 w-8" />;
    case "check":
      return <CheckBadgeIcon className="h-8 w-8" />;
    case "sparkles":
      return <SparklesIcon className="h-8 w-8" />;
    case "trophy":
      return <TrophyIcon className="h-8 w-8" />;
    default:
      return <ShieldCheckIcon className="h-8 w-8" />;
  }
};

const getScoreColor = (score: number, maxScore: number): string => {
  const percentage = (score / maxScore) * 100;

  if (percentage >= 80) return "text-success";
  if (percentage >= 60) return "text-primary";
  if (percentage >= 40) return "text-warning";
  return "text-error";
};

const getScoreLabel = (score: number, maxScore: number): string => {
  const percentage = (score / maxScore) * 100;

  if (percentage >= 80) return "Excellent";
  if (percentage >= 60) return "Good";
  if (percentage >= 40) return "Fair";
  return "Poor";
};

export const ProviderScoreCard: React.FC<ProviderScoreCardProps> = ({
  name,
  score,
  maxScore,
  description,
  icon,
  logo,
  websiteUrl,
  isLoading = false,
  error,
  comingSoon = false,
}) => {
  const percentage = (score / maxScore) * 100;
  const scoreColor = getScoreColor(score, maxScore);
  const scoreLabel = getScoreLabel(score, maxScore);

  const renderIcon = () => {
    if (logo) {
      if (websiteUrl) {
        return (
          <a
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-12 h-12 rounded-lg bg-base-200 flex items-center justify-center flex-shrink-0 hover:opacity-80 transition-opacity"
          >
            <Image
              src={logo}
              alt={`${name} logo`}
              width={48}
              height={48}
              className="w-full h-full object-cover rounded-lg"
            />
          </a>
        );
      }
      return (
        <div className="w-12 h-12 rounded-lg bg-base-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
          <Image
            src={logo}
            alt={`${name} logo`}
            width={48}
            height={48}
            className="w-full h-full object-cover rounded-lg"
          />
        </div>
      );
    }
    return <div className="text-base-content/30">{getIcon(icon)}</div>;
  };

  if (comingSoon) {
    return (
      <div className="provider-card opacity-60 relative overflow-hidden">
        <div className="flex items-start gap-4">
          {renderIcon()}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-base-content/70">{name}</h3>
              <span className="text-xs font-medium px-2 py-1 bg-primary/10 text-primary rounded-full">Coming Soon</span>
            </div>
            <p className="text-sm text-base-content/50 mb-3">{description}</p>
            <div className="w-full bg-base-300/50 rounded-full h-2 overflow-hidden">
              <div className="h-full bg-base-300 rounded-full" style={{ width: "0%" }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="provider-card opacity-50">
        <div className="flex items-start gap-4">
          {logo ? (
            <div className="w-12 h-12 rounded-lg bg-base-200 flex items-center justify-center opacity-40 flex-shrink-0 overflow-hidden">
              <Image
                src={logo}
                alt={`${name} logo`}
                width={48}
                height={48}
                className="w-full h-full object-cover rounded-lg grayscale"
              />
            </div>
          ) : (
            <div className="text-base-content/40">{getIcon(icon)}</div>
          )}
          <div className="flex-1">
            <h3 className="font-semibold text-base-content/60 mb-1">{name}</h3>
            <p className="text-sm text-error">Unable to fetch score</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="provider-card">
        <div className="flex items-start gap-4">
          {logo ? (
            <div className="w-12 h-12 rounded-lg bg-base-200 flex items-center justify-center animate-pulse flex-shrink-0 overflow-hidden">
              <Image
                src={logo}
                alt={`${name} logo`}
                width={48}
                height={48}
                className="w-full h-full object-cover rounded-lg opacity-40"
              />
            </div>
          ) : (
            <div className="text-base-content/40 animate-pulse">{getIcon(icon)}</div>
          )}
          <div className="flex-1">
            <div className="h-5 bg-base-300 rounded w-24 mb-2 animate-pulse"></div>
            <div className="h-4 bg-base-300 rounded w-full mb-3 animate-pulse"></div>
            <div className="h-2 bg-base-300 rounded w-full animate-pulse"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="provider-card">
      <div className="flex items-start gap-4">
        {renderIcon()}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-base-content">
              {websiteUrl ? (
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-primary transition-colors"
                >
                  {name}
                </a>
              ) : (
                name
              )}
            </h3>
            <span className={`text-sm font-medium ${scoreColor}`} aria-label={`Score rating: ${scoreLabel}`}>
              {scoreLabel}
            </span>
          </div>
          <p className="text-sm text-base-content/60 mb-3">{description}</p>

          {/* Score bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-base-content/60">Score</span>
              <span className={`font-semibold ${scoreColor}`}>
                {score}/{maxScore}
              </span>
            </div>
            <div
              className="w-full bg-base-300 rounded-full h-2 overflow-hidden"
              role="progressbar"
              aria-valuenow={Math.round(percentage)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${name} score progress`}
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  percentage >= 80
                    ? "bg-success"
                    : percentage >= 60
                      ? "bg-primary"
                      : percentage >= 40
                        ? "bg-warning"
                        : "bg-error"
                }`}
                style={{ width: `${Math.min(percentage, 100)}%` }}
              />
            </div>
            <div className="text-right text-xs text-base-content/60">{percentage.toFixed(0)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
};
