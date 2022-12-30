pragma solidity 0.5.16;

import "./ERC20.sol";
import "./ERC20Detailed.sol";

contract MockToken is ERC20, ERC20Detailed {
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals
    ) public ERC20Detailed(name, symbol, decimals) {
        _mint(msg.sender, 10000000000 * (10**uint256(decimals)));
    }

    function faucet(address _account) external {
        _mint(_account, 1000000 * (10**uint256(decimals())));
    }
}
