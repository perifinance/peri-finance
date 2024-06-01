pragma solidity 0.5.16;

interface ICrossChainManager {
    // View Functions
    function crossChainState() external view returns (address);

    function debtManager() external view returns (address);

    // supply schedule wrapper functions
    // function mintableSupply() external view returns (uint);
    // // supply schedule wrapper functions
    // function isMintable() external view returns (bool);
    // // supply schedule wrapper functions
    // function minterReward() external view returns (uint);

    // function getCrossChainIds() external view returns (bytes32[] memory);

    // function getNetworkId(bytes32 _chainID) external view returns (uint);

    function currentNetworkIssuedDebtOf(bytes32 currencyKey) external view returns (uint, bool);

    function currentNetworkActiveDebtOf(bytes32 currencyKey) external view returns (uint, bool);

    function currentNetworkIssuedDebt() external view returns (uint);

    function currentNetworkActiveDebt() external view returns (uint);

    // function getCrossNetworkIssuedDebt(bytes32 _chainID) external view returns (uint);

    // function getCrossNetworkActiveDebt(bytes32 _chainID) external view returns (uint);

    function crossNetworkIssuedDebtAll() external view returns (uint);

    function crossNetworkActiveDebtAll() external view returns (uint);

    function currentNetworkDebtPercentage() external view returns (uint);

    function movedAmount(uint _inboundOutbound, uint targetNetworkId) external view returns (uint);

    function outboundSumToCurrentNetwork() external view returns (uint);

    function syncTimestamp() external view returns (uint);

    function syncStale() external view returns (bool);

    // Mutative functions
    function setCrossChainState(address) external;

    function setDebtManager(address) external;

    // supply schedule wrapper functions
    // function recordMintEvent(uint supplyMinted) external returns (bool);

    // function setCrosschain(bytes32 _chainID) external;

    // function addCrosschain(bytes32 _chainID) external;

    // function addNetworkId(bytes32 _chainID, uint _networkId) external;

    // function addNetworkIds(uint[] calldata _networkIds) external;

    function addCurrentNetworkIssuedDebt(uint _amount) external;

    function subtractCurrentNetworkIssuedDebt(uint _amount) external;

    function setCrossNetworkIssuedDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts) external;

    function setCrossNetworkActiveDebtAll(uint[] calldata _chainIDs, uint[] calldata _amounts) external;

    function setOutboundSumToCurrentNetwork(uint _amount) external;

    // deprecated functions --> to be removed. they do nothing inside the contract
    // for backwards compatibility with Exchanger
    function addTotalNetworkDebt(uint amount) external;

    // for backwards compatibility with Exchanger
    function subtractTotalNetworkDebt(uint amount) external;

    // for backwards compatibility with Issuer
    function setCrossNetworkUserDebt(address account, uint userStateDebtLedgerIndex) external;

    // for backwards compatibility with Issuer
    function clearCrossNetworkUserDebt(address account) external;
}
