pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import "./PeriFinance.sol";

contract PeriFinanceToPolygon is PeriFinance {
    address public childChainManager;

    constructor(
        address payable _proxy,
        TokenState _tokenState,
        address _owner,
        uint _totalSupply,
        address _resolver,
        address _childChainManager,
        address _blacklistManager,
        address payable _bridgeValidator
    )
        public
        PeriFinance(
            _proxy,
            _tokenState,
            _owner,
            _totalSupply,
            _resolver,
            _childChainManager,
            _blacklistManager,
            _bridgeValidator
        )
    {
        childChainManager = _childChainManager;
    }

    // function multiTransfer(address[] calldata _recipients, uint[] calldata _amounts)
    //     external
    //     optionalProxy
    //     systemActive
    //     blacklisted(messageSender)
    //     returns (bool)
    // {
    //     return false;
    // require(_recipients.length == _amounts.length, "length is not matched");

    // bool transferResult = true;
    // for (uint i = 0; i < _recipients.length; i++) {
    //     if (_recipients[i] == address(0) || _amounts[i] == 0) {
    //         continue;
    //     }

    //     _canTransfer(messageSender, _amounts[i]);
    //     require(_transferByProxy(messageSender, _recipients[i], _amounts[i]), "Transfer failed");
    // }

    // return transferResult;
    // }

    function setChildChainManager(address _childChainManager) external onlyOwner {
        require(_childChainManager != address(0), "Address cannot be zero");

        childChainManager = _childChainManager;
    }

    function deposit(address _user, bytes calldata depositData) external optionalProxy {
        require(messageSender == childChainManager, "Caller can't deposit");

        uint amount = abi.decode(depositData, (uint256));

        tokenState.setBalanceOf(_user, tokenState.balanceOf(_user).add(amount));

        emitTransfer(address(0), _user, amount);
    }

    function withdraw(uint _amount) external optionalProxy {
        tokenState.setBalanceOf(messageSender, tokenState.balanceOf(messageSender).sub(_amount));

        emitTransfer(messageSender, address(0), _amount);
    }
}
