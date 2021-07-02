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

    function transfer(address to, uint value) external optionalProxy systemActive returns (bool) {
        _transferByProxy(messageSender, to, value);
    }

    function transferFrom(
        address from,
        address to,
        uint value
    ) external optionalProxy systemActive returns (bool) {
        return _transferFromByProxy(messageSender, from, to, value);
    }
}
