import React from "react";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  className?: string;
}

export const StatsCard: React.FC<StatsCardProps> = ({ title, value, subtitle, icon, trend, className = "" }) => {
  return (
    <div className={`stat-card ${className}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm font-medium text-base-content/70">{title}</div>
        {icon && <div className="p-2 rounded-lg bg-primary/10 text-primary">{icon}</div>}
      </div>
      <div className="text-3xl font-bold text-base-content mb-1">{value}</div>
      {subtitle && <div className="text-sm text-base-content/50">{subtitle}</div>}
      {trend && (
        <div className={`text-sm mt-2 font-medium ${trend.isPositive ? "text-success" : "text-error"}`}>
          {trend.isPositive ? "↑" : "↓"} {trend.value}
        </div>
      )}
    </div>
  );
};
