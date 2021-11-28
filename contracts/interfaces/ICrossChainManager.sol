pragma solidity 0.5.16;

interface ICrossChainManager {
    // View Functions
    function crossChainState() external view returns (address);

    function debtManager() external view returns (address);

    function currentTotalNetworkDebt() external view returns (uint);

    function ownedDebtPercentageAtIndex(uint) external view returns (uint);

    function currentOwnedDebtPercentage() external view returns (uint);

    // Mutative functions
    function setCrossChainState(address) external;

    function setDebtManager(address) external;

    function addTotalNetworkDebt(uint) external;

    function setCrossNetworkUserDebt(address, uint) external;

    function clearCrossNetworkUserDebt(address) external;
}
