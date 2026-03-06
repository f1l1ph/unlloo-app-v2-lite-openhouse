// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {IUnlloo} from "../IUnlloo.sol";
import {UnllooErrors} from "../errors/UnllooErrors.sol";

/**
 * @title UnllooStatusArray
 * @notice Library for managing loan status arrays with O(1) operations
 * @dev Extracted for code organization (internal libraries are inlined by the compiler)
 */
library UnllooStatusArray {
    /**
     * @notice Add loan ID to status array and index mapping
     * @param self Storage reference to the status array
     * @param indexMap Storage reference to the index mapping
     * @param loanId Loan ID to add
     * @param status Loan status
     */
    function add(
        uint256[] storage self,
        mapping(uint256 => uint256) storage indexMap,
        uint256 loanId,
        IUnlloo.LoanStatus status
    ) internal {
        uint256 existingIndex = indexMap[loanId];

        if (existingIndex < self.length && self[existingIndex] == loanId) {
            revert UnllooErrors.LoanAlreadyInStatus(loanId, uint8(status));
        }

        self.push(loanId);
        indexMap[loanId] = self.length - 1;
    }

    /**
     * @notice Remove loan ID from status array in O(1)
     * @param self Storage reference to the status array
     * @param indexMap Storage reference to the index mapping
     * @param loanId Loan ID to remove
     */
    function remove(
        uint256[] storage self,
        mapping(uint256 => uint256) storage indexMap,
        uint256 loanId,
        IUnlloo.LoanStatus
    ) internal {
        // Cache length to avoid redundant storage reads
        uint256 length = self.length;
        
        if (length == 0) {
            revert UnllooErrors.LoanNotFound(loanId);
        }

        uint256 index = indexMap[loanId];

        // Combine checks: index must be valid AND array element must match loanId
        if (index >= length || self[index] != loanId) {
            revert UnllooErrors.LoanNotFound(loanId);
        }

        uint256 lastIndex = length - 1;

        if (index != lastIndex) {
            uint256 lastLoanId = self[lastIndex];
            self[index] = lastLoanId;
            indexMap[lastLoanId] = index;
        }

        self.pop();
        delete indexMap[loanId];
    }
}
