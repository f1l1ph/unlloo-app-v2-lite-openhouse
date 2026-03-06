"use client";

import React, { useRef } from "react";
import { ArrowPathIcon, InformationCircleIcon } from "@heroicons/react/24/outline";

interface RefreshDataModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const RefreshDataModal: React.FC<RefreshDataModalProps> = ({ isOpen, onConfirm, onCancel }) => {
  const modalCheckboxRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (modalCheckboxRef.current) {
      modalCheckboxRef.current.checked = isOpen;
    }
  }, [isOpen]);

  const handleConfirm = () => {
    onConfirm();
    if (modalCheckboxRef.current) {
      modalCheckboxRef.current.checked = false;
    }
  };

  const handleCancel = () => {
    onCancel();
    if (modalCheckboxRef.current) {
      modalCheckboxRef.current.checked = false;
    }
  };

  return (
    <>
      <input type="checkbox" id="refresh-data-modal" className="modal-toggle" ref={modalCheckboxRef} />
      <label htmlFor="refresh-data-modal" className="modal cursor-pointer">
        <label className="modal-box relative max-w-md">
          {/* Close button */}
          <label
            htmlFor="refresh-data-modal"
            className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3"
            onClick={handleCancel}
          >
            ✕
          </label>

          <div>
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10">
                <ArrowPathIcon className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-base-content">Refresh Reputation Data</h3>
                <p className="text-sm text-base-content/60">Force a fresh calculation</p>
              </div>
            </div>

            {/* Information Alert */}
            <div role="alert" className="alert alert-info mb-4 bg-info/10 border-info/20">
              <InformationCircleIcon className="h-5 w-5 text-info" />
              <div className="text-sm text-base-content/80">
                <p className="font-medium mb-1">What happens when you refresh?</p>
                <ul className="list-disc list-inside space-y-1 text-xs text-base-content/70">
                  <li>Bypasses the cache (normally cached for 1 week)</li>
                  <li>Fetches fresh data from all reputation providers</li>
                  <li>May take longer to load (10-30 seconds)</li>
                  <li>Uses API quota from third-party services</li>
                </ul>
              </div>
            </div>

            {/* Explanation */}
            <div className="bg-base-200/50 rounded-lg p-4 mb-6">
              <p className="text-sm text-base-content/70">
                Your reputation data is typically cached for <strong className="text-base-content">1 week</strong> to
                improve performance and reduce API costs. Refreshing will bypass this cache and fetch the latest data
                from all providers, which may result in updated scores if your on-chain activity has changed.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 justify-end">
              <button className="btn btn-ghost" onClick={handleCancel}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirm}>
                <ArrowPathIcon className="h-4 w-4" />
                Refresh Now
              </button>
            </div>
          </div>
        </label>
      </label>
    </>
  );
};
