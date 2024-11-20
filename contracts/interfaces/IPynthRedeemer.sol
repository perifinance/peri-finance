pragma solidity >=0.4.24;

import "./IERC20.sol";

interface IPynthRedeemer {
    // Rate of redemption - 0 for none
    function redemptions(address pynthProxy) external view returns (uint redeemRate);

    // pUSD balance of deprecated token holder
    function balanceOf(IERC20 pynthProxy, address account) external view returns (uint balanceOfInpUSD);

    // Full pUSD supply of token
    function totalSupply(IERC20 pynthProxy) external view returns (uint totalSupplyInpUSD);

    function redeem(IERC20 pynthProxy) external;

    function redeemAll(IERC20[] calldata pynthProxies) external;

    function redeemPartial(IERC20 pynthProxy, uint amountOfPynth) external;

    // Restricted to Issuer
    function deprecate(IERC20 pynthProxy, uint rateToRedeem) external;
}
