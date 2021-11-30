pragma solidity 0.5.16;

interface ICrossChainState {
    struct CrossNetworkUserData {
        // total network debtLedgerIndex
        uint totalNetworkDebtLedgerIndex;
        // user state debtledgerIndex
        uint userStateDebtLedgerIndex;
    }

    // Views
    function totalNetworkDebtLedgerLength() external view returns (uint);

    function lastTotalNetworkDebtLedgerEntry() external view returns (uint);

    function getTotalNetworkDebtEntryAtIndex(uint) external view returns (uint);

    function getCrossNetworkUserData(address) external view returns (uint, uint);

    // Mutative functions
    function setCrossNetworkUserData(address, uint) external;

    function clearCrossNetworkUserData(address) external;

    function appendTotalNetworkDebtLedger(uint) external;
}
