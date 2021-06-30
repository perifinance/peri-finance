pragma solidity 0.5.16;

import "../TradingRewards.sol";

import "openzeppelin-solidity-2.3.0/contracts/token/ERC20/ERC20Detailed.sol";

import "../interfaces/IExchanger.sol";

contract FakeTradingRewards is TradingRewards {
    IERC20 public _mockPeriFinanceToken;

    constructor(
        address owner,
        address periodController,
        address resolver,
        address mockPeriFinanceToken
    ) public TradingRewards(owner, periodController, resolver) {
        _mockPeriFinanceToken = IERC20(mockPeriFinanceToken);
    }

    // PeriFinance is mocked with an ERC20 token passed via the constructor.
    function periFinance() internal view returns (IERC20) {
        return IERC20(_mockPeriFinanceToken);
    }

    // Return msg.sender so that onlyExchanger modifier can be bypassed.
    function exchanger() internal view returns (IExchanger) {
        return IExchanger(msg.sender);
    }
}
