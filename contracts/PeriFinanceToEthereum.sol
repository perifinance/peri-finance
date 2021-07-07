pragma solidity 0.5.16;

import "./PeriFinance.sol";

contract PeriFinanceToEthereum is PeriFinance {
    address public childChainManager;

    constructor(
        address payable _proxy,
        TokenState _tokenState,
        address _owner,
        uint _totalSupply,
        address _resolver,
        address _minterRole
    ) public PeriFinance(_proxy, _tokenState, _owner, _totalSupply, _resolver, _minterRole) {}

    function inflationalMint() external returns (bool) {
        _notImplemented();
    }

    function issuePynthsAndStakeUSDC(uint _issueAmount, uint _usdcStakeAmount) external {
        _notImplemented();
    }

    function issueMaxPynths() external {
        _notImplemented();
    }

    function issuePynthsAndStakeMaxUSDC(uint _issueAmount) external {
        _notImplemented();
    }

    function burnPynthsAndUnstakeUSDC(uint _burnAmount, uint _unstakeAmount) external {
        _notImplemented();
    }

    function burnPynthsAndUnstakeUSDCToTarget() external {
        _notImplemented();
    }

    function exchange(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey
    ) external returns (uint amountReceived) {
        _notImplemented();
    }

    function exchangeOnBehalf(
        address exchangeForAddress,
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey
    ) external returns (uint amountReceived) {
        _notImplemented();
    }

    function exchangeWithTracking(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address originator,
        bytes32 trackingCode
    ) external returns (uint amountReceived) {
        _notImplemented();
    }

    function exchangeOnBehalfWithTracking(
        address exchangeForAddress,
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        address originator,
        bytes32 trackingCode
    ) external returns (uint amountReceived) {
        _notImplemented();
    }

    function exchangeWithVirtual(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        bytes32 trackingCode
    ) external returns (uint amountReceived, IVirtualPynth vPynth) {
        _notImplemented();
    }

    function settle(bytes32 currencyKey)
        external
        returns (
            uint reclaimed,
            uint refunded,
            uint numEntries
        )
    {
        _notImplemented();
    }

    function liquidateDelinquentAccount(address account, uint pusdAmount) external returns (bool) {
        _notImplemented();
    }

    function transfer(address to, uint value) external optionalProxy systemActive returns (bool) {
        return _transferByProxy(messageSender, to, value);
    }

    function transferFrom(
        address from,
        address to,
        uint value
    ) external optionalProxy systemActive returns (bool) {
        return _transferFromByProxy(messageSender, from, to, value);
    }
}
