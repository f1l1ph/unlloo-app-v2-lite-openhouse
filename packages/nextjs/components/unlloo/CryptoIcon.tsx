import React from "react";

interface CryptoIconProps {
  symbol: string;
  size?: number;
}

/**
 * Component to display cryptocurrency icons
 * For now, displays a simple badge with the symbol
 * In production, this could fetch actual token icons
 */
export const CryptoIcon: React.FC<CryptoIconProps> = ({ symbol, size = 24 }) => {
  return (
    <div
      className="rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {symbol.slice(0, 2).toUpperCase()}
    </div>
  );
};
