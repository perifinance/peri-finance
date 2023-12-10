pragma solidity 0.5.16;

interface ICrossChainState {
    struct CrossNetworkUserData {
        // total network debtLedgerIndex
        uint totalNetworkDebtLedgerIndex;
        // user state debtledgerIndex
        uint userStateDebtLedgerIndex;
    }

    // Views
    function getChainID() external view returns (uint);

    function crossChainCount() external view returns (uint);

    function currentNetworkIssuedDebt() external view returns (uint);

    function totalNetworkIssuedDebt() external view returns (uint);

    function crossNetworkIssuedDebtAll() external view returns (uint);

    function crossNetworkActiveDebtAll() external view returns (uint);

    function outboundSumToCurrentNetwork() external view returns (uint);

    // Mutative functions
    function addNetworkId(uint _networkId) external;

    function setCrossNetworkIssuedDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts) external;

    function setCrossNetworkActiveDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts) external;

    function setCrossNetworkDebtsAll(
        uint[] calldata _chainIDs,
        uint[] calldata _debts,
        uint[] calldata _activeDebts,
        uint _inbound
    ) external;

    function addCrossNetworkNDebts(
        uint _chainID,
        uint _issuedDebt,
        uint _activeDebt
    ) external;

    function addIssuedDebt(uint _chainID, uint _amount) external;

    function subtractIssuedDebt(uint _chainID, uint _amount) external;

    function setOutboundSumToCurrentNetwork(uint _amount) external;

    function setInitialCurrentIssuedDebt(uint _amount) external;

    // deprecated functions --> to be removed. they do nothing inside the contract
    // function totalNetworkDebtLedgerLength() external view returns (uint);

    // function lastTotalNetworkDebtLedgerEntry() external view returns (uint);

    // function getTotalNetworkDebtEntryAtIndex(uint) external view returns (uint);

    // function getCrossNetworkUserData(address) external view returns (uint, uint);

    // function getCrossChainIds() external view returns (bytes32[] memory);

    // function getNetworkId(bytes32 _chainID) external view returns (uint);

    // function getCrossNetworkIssuedDebt(bytes32 _chainID) external view returns (uint);

    // function getCrossNetworkActiveDebt(bytes32 _chainID) external view returns (uint);

    // function setCrossNetworkUserData(address, uint) external;

    // function clearCrossNetworkUserData(address) external;

    // function appendTotalNetworkDebtLedger(uint) external;

    // function addTotalNetworkDebtLedger(uint amount) external;

    // function subtractTotalNetworkDebtLedger(uint amount) external;

    // function setCrosschain(bytes32 _chainID) external;

    // function addCrosschain(bytes32 chainID) external;
}
