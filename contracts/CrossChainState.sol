pragma solidity 0.5.16;

// Inheritance
import "./Owned.sol";
import "./State.sol";
import "./interfaces/ICrossChainState.sol";

/**
 * @title CrossChainState
 * @author @Enitsed
 * @notice This contract saves data of All the networks staking system debt
 */
contract CrossChainState is Owned, State, ICrossChainState {
    // the total network debt and current network debt percentage
    mapping(address => CrossNetworkUserData) private _crossNetworkUserData;

    uint[] internal _totalNetworkDebtLedger;

    constructor(address _owner, address _associatedContract) public Owned(_owner) State(_associatedContract) {}

    // View functions

    /**
     * @notice returns the length of total network debt entry
     * @return uint
     */
    function totalNetworkDebtLedgerLength() external view returns (uint) {
        return _totalNetworkDebtLedger.length;
    }

    /**
     * @notice returns the latest total network debt
     * @return uint
     */
    function lastTotalNetworkDebtLedgerEntry() external view returns (uint) {
        return _getTotalNetworkDebtEntryAtIndex(_totalNetworkDebtLedger.length - 1);
    }

    /**
     * @notice returns the total network debt amount at index
     * @param index uint
     * @return uint
     */
    function getTotalNetworkDebtEntryAtIndex(uint index) external view returns (uint) {
        return _getTotalNetworkDebtEntryAtIndex(index);
    }

    function getCrossNetworkUserData(address account)
        external
        view
        returns (uint crossChainDebtEntryIndex, uint userStateDebtLedgerIndex)
    {
        crossChainDebtEntryIndex = _crossNetworkUserData[account].totalNetworkDebtLedgerIndex;
        userStateDebtLedgerIndex = _crossNetworkUserData[account].userStateDebtLedgerIndex;
    }

    function _getTotalNetworkDebtEntryAtIndex(uint index) internal view returns (uint) {
        return _totalNetworkDebtLedger[index];
    }

    // Mutative functions

    /**
     * @notice set total network status when user's debt ownership is changed
     * @param from address
     * @param userStateDebtLedgerIndex uint
     */
    function setCrossNetworkUserData(address from, uint userStateDebtLedgerIndex) external onlyAssociatedContract {
        _crossNetworkUserData[from] = CrossNetworkUserData(_totalNetworkDebtLedger.length - 1, userStateDebtLedgerIndex);

        emit UserCrossNetworkDataUpdated(from, userStateDebtLedgerIndex, block.timestamp);
    }

    /**
     * @notice clear the user's total network debt info
     * @param from address
     */
    function clearCrossNetworkUserData(address from) external onlyAssociatedContract {
        delete _crossNetworkUserData[from];

        emit UserCrossNetworkDataRemoved(from, block.timestamp);
    }

    /**
     * @notice append total network debt to the entry
     * @param totalNetworkDebt uint
     */
    function appendTotalNetworkDebtLedger(uint totalNetworkDebt) external onlyAssociatedContract {
        _totalNetworkDebtLedger.push(totalNetworkDebt);

        emit TotalNetworkDebtAdded(totalNetworkDebt, block.timestamp);
    }

    // Events

    /**
     * @notice Emitted when totalNetworkDebt has added
     * @param totalNetworkDebt uint
     * @param timestamp uint
     */
    event TotalNetworkDebtAdded(uint totalNetworkDebt, uint timestamp);

    /**
     * @notice Emitted when user cross network data updated
     * @param account address
     * @param userStateDebtLedgerIndex uint
     * @param timestamp uint
     */
    event UserCrossNetworkDataUpdated(address account, uint userStateDebtLedgerIndex, uint timestamp);

    /**
     * @notice Emitted when user cross network data deleted
     * @param account address
     * @param timestamp uint
     */
    event UserCrossNetworkDataRemoved(address account, uint timestamp);
}
