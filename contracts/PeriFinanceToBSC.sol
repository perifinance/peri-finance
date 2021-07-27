pragma solidity 0.5.16;

import "./PeriFinance.sol";

contract PeriFinanceToBSC is PeriFinance {
    constructor(
        address payable _proxy,
        TokenState _tokenState,
        address _owner,
        uint _totalSupply,
        address _resolver,
        address _minterRole,
        address _blacklistManager
    ) public PeriFinance(_proxy, _tokenState, _owner, _totalSupply, _resolver, _minterRole, _blacklistManager) {}

    function multiTransfer(address[] calldata _recipients, uint[] calldata _amounts)
        external
        optionalProxy
        systemActive
        blacklisted(messageSender)
        returns (bool)
    {
        require(_recipients.length == _amounts.length, "length is not matched");

        bool transferResult = true;
        for (uint i = 0; i < _recipients.length; i++) {
            if (_recipients[i] == address(0) || _amounts[i] == 0) {
                continue;
            }

            _canTransfer(messageSender, _amounts[i]);
            require(_transferByProxy(messageSender, _recipients[i], _amounts[i]), "Transfer failed");
        }

        return transferResult;
    }
}
