pragma solidity 0.5.16;

interface ICrossChainState {
    struct CrossNetworkUserData {
        // user debt ownership percentage of total network debt
        uint userOwnershipOfTotalNetwork;
        // total network debtLedgerIndex
        uint64 totalNetworkDebtLedgerIndex;
    }

    // Views
    function totalNetworkDebtLedgerLength() external view returns (uint);

    function lastTotalNetworkDebtLedgerEntry() external view returns (uint);

    function getTotalNetworkDebtEntryAtIndex(uint) external view returns (uint);

    function getCrossNetworkUserData(address) external view returns (uint, uint64);

    // Mutative functions
    function setCrossNetworkUserData(
        address,
        uint,
        uint
    ) external;

    function clearCrossNetworkUserData(address) external;

    function appendTotalNetworkDebtLedger(uint) external;
}
