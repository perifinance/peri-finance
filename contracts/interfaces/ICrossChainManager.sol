pragma solidity 0.5.16;

interface ICrossChainManager {
    // View Functions
    function crossChainState() external view returns (address);

    function debtManager() external view returns (address);

    function userIssuanceDataForTotalNetwork(address) external view returns (uint, uint);

    function getTotalNetworkAdaptedTotalSystemValue(address, uint) external view returns (uint);

    function currentTotalNetworkDebt() external view returns (uint);

    function totalNetworkDebtAtIndex(uint index) external view returns (uint);

    function networkDebtPercentageAtIndex(uint) external view returns (uint);

    function totalNetworkDebtEntryLength() external view returns (uint);

    function currentNetworkDebtPercentage() external view returns (uint);

    // Mutative functions
    function setCrossChainState(address) external;

    function setDebtManager(address) external;

    function addTotalNetworkDebt(uint) external;

    function setCrossNetworkUserDebt(address, uint) external;

    function clearCrossNetworkUserDebt(address) external;
}