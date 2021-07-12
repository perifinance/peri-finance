pragma solidity 0.5.16;

import "./PeriFinance.sol";

contract PeriFinanceToEthereum is PeriFinance {
    constructor(
        address payable _proxy,
        TokenState _tokenState,
        address _owner,
        uint _totalSupply,
        address _resolver,
        address _minterRole,
        address _blacklistManager
    ) public PeriFinance(_proxy, _tokenState, _owner, _totalSupply, _resolver, _minterRole, _blacklistManager) {}
}
