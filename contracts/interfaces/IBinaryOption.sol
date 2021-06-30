pragma solidity 0.5.16;

import "../interfaces/IBinaryOptionMarket.sol";
import "../interfaces/IERC20.sol";

// https://docs.peri.finance/contracts/source/interfaces/ibinaryoption
interface IBinaryOption {
    /* ========== VIEWS / VARIABLES ========== */

    function market() external view returns (IBinaryOptionMarket);

    function bidOf(address account) external view returns (uint);

    function totalBids() external view returns (uint);

    function balanceOf(address account) external view returns (uint);

    function totalSupply() external view returns (uint);

    function claimableBalanceOf(address account) external view returns (uint);

    function totalClaimableSupply() external view returns (uint);
}
