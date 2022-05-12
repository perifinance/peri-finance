pragma solidity 0.5.16;

interface ICrossChainManager {
    // View Functions
    function crossChainState() external view returns (address);

    function debtManager() external view returns (address);

    function userIssuanceDataForTotalNetwork(address) external view returns (uint, uint);

    function getTotalNetworkAdaptedTotalSystemValue(bytes32 currencyKey) external view returns (uint, bool);

    function currentTotalNetworkDebt() external view returns (uint);

    function totalNetworkDebtEntryLength() external view returns (uint);

    function currentNetworkDebtPercentage() external view returns (uint);

    // Mutative functions
    function setCrossChainState(address) external;

    function setDebtManager(address) external;

    function appendTotalNetworkDebt(uint) external;

    function addTotalNetworkDebt(uint) external;

    function subtractTotalNetworkDebt(uint) external;

    function setCrossNetworkUserDebt(address, uint) external;

    function clearCrossNetworkUserDebt(address) external;

    function setCrosschain(bytes32 _chainID) external;

    function addCrosschain(bytes32 _chainID) external;

    function addNetworkId(bytes32 _chainID, uint _networkId) external;

    function getNetworkId(bytes32 _chainID) external view returns (uint);

    function setCrossNetworkIssuedDebt(bytes32 _chainID, uint _amount) external;

    function getCrossNetworkIssuedDebt(bytes32 _chainID) external view returns (uint);

    function setCrossNetworkActiveDebt(bytes32 _chainID, uint _amount) external;

    function getCrossNetworkActiveDebt(bytes32 _chainID) external view returns (uint);

    function setCrossNetworkIssuedDebtAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts) external;

    function getCrossNetworkIssuedDebtAll() external view returns (uint);

    function setCrossNetworkActiveDebtAll(bytes32[] calldata _chainIDs, uint[] calldata _amounts) external;

    function getCrossNetworkActiveDebtAll() external view returns (uint);

    function getCurrentNetworkIssuedDebt() external view returns (uint);

    function getCurrentNetworkActiveDebt() external view returns (uint);

    function addCurrentNetworkIssuedDebt(uint _amount) external;

    function subtractCurrentNetworkIssuedDebt(uint _amount) external;

    function getCurrentNetworkAdaptedActiveDebtValue(bytes32 currencyKey)
        external
        view
        returns (uint totalSystemValue, bool anyRateIsInvalid);
}
