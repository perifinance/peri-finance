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

    function _getTotalNetworkDebtEntryAtIndex(uint index) internal view returns (uint) {
        require(_totalNetworkDebtLedger.length > 0, "There is no available data");

        return _totalNetworkDebtLedger[index];
    }

    // Mutative functions

    /**
     * @notice set total network status when user's debt ownership is changed
     * @param from address
     * @param _userOwnershipOfTotalNetwork uint
     * @param _totalNetworkDebtLedgerIndex uint
     */
    function setCrossNetworkUserData(
        address from,
        uint _userOwnershipOfTotalNetwork,
        uint _totalNetworkDebtLedgerIndex
    ) external onlyAssociatedContract {
        _crossNetworkUserData[from] = CrossNetworkUserData({
            userOwnershipOfTotalNetwork: _userOwnershipOfTotalNetwork,
            totalNetworkDebtLedgerIndex: _totalNetworkDebtLedgerIndex
        });
    }

    /**
     * @notice clear the user's total network debt info
     * @param from address
     */
    function clearCrossNetworkUserData(address from) external onlyAssociatedContract {
        delete _crossNetworkUserData[from];
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
}
