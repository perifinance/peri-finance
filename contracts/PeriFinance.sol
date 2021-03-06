pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// Inheritance
import "./BasePeriFinance.sol";

// Internal references
import "./interfaces/IRewardEscrowV2.sol";
import "./interfaces/ISupplySchedule.sol";
import "./interfaces/IBridgeState.sol";

interface ICrossChainManager {
    function currentNetworkDebtPercentage() external view returns (uint);
}

// https://docs.peri.finance/contracts/source/contracts/periFinance
contract PeriFinance is BasePeriFinance {
    // ========== ADDRESS RESOLVER CONFIGURATION ==========
    bytes32 private constant CONTRACT_REWARDESCROW_V2 = "RewardEscrowV2";
    bytes32 private constant CONTRACT_SUPPLYSCHEDULE = "SupplySchedule";
    bytes32 private constant CONTRACT_CROSSCHAINMANAGER = "CrossChainManager";

    address public minterRole;
    address public inflationMinter;
    address payable public bridgeValidator;

    IBridgeState public bridgeState;

    // ========== CONSTRUCTOR ==========

    constructor(
        address payable _proxy,
        TokenState _tokenState,
        address _owner,
        uint _totalSupply,
        address _resolver,
        address _minterRole,
        address _blacklistManager,
        address payable _bridgeValidator
    ) public BasePeriFinance(_proxy, _tokenState, _owner, _totalSupply, _resolver, _blacklistManager) {
        minterRole = _minterRole;
        bridgeValidator = _bridgeValidator;
    }

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = BasePeriFinance.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](3);
        newAddresses[0] = CONTRACT_REWARDESCROW_V2;
        newAddresses[1] = CONTRACT_SUPPLYSCHEDULE;
        newAddresses[2] = CONTRACT_CROSSCHAINMANAGER;
        return combineArrays(existingAddresses, newAddresses);
    }

    // ========== VIEWS ==========

    function rewardEscrowV2() internal view returns (IRewardEscrowV2) {
        return IRewardEscrowV2(requireAndGetAddress(CONTRACT_REWARDESCROW_V2));
    }

    function supplySchedule() internal view returns (ISupplySchedule) {
        return ISupplySchedule(requireAndGetAddress(CONTRACT_SUPPLYSCHEDULE));
    }

    function crossChainManager() internal view returns (ICrossChainManager) {
        return ICrossChainManager(requireAndGetAddress(CONTRACT_CROSSCHAINMANAGER));
    }

    // ========== OVERRIDDEN FUNCTIONS ==========

    function settle(bytes32 currencyKey)
        external
        optionalProxy
        blacklisted(messageSender)
        returns (
            uint reclaimed,
            uint refunded,
            uint numEntriesSettled
        )
    {
        return exchanger().settle(messageSender, currencyKey);
    }

    function inflationalMint() external issuanceActive returns (bool) {
        require(msg.sender == inflationMinter, "Minter only");
        require(address(rewardsDistribution()) != address(0), "RewardsDistribution not set");

        ISupplySchedule _supplySchedule = supplySchedule();
        IRewardsDistribution _rewardsDistribution = rewardsDistribution();

        uint _currRate = crossChainManager().currentNetworkDebtPercentage();
        require(SafeDecimalMath.preciseUnit() >= _currRate, "Network debt rate invalid");

        uint supplyToMint = _supplySchedule.mintableSupply();
        supplyToMint = supplyToMint
            .decimalToPreciseDecimal()
            .multiplyDecimalRoundPrecise(_currRate)
            .preciseDecimalToDecimal();
        require(supplyToMint > 0, "No supply is mintable");

        // record minting event before mutation to token supply
        _supplySchedule.recordMintEvent(supplyToMint);

        // Set minted PERI balance to RewardEscrow's balance
        // Minus the minterReward and set balance of minter to add reward
        uint minterReward = _supplySchedule.minterReward();
        // Get the remainder
        uint amountToDistribute = supplyToMint.sub(minterReward);

        // Set the token balance to the RewardsDistribution contract
        tokenState.setBalanceOf(
            address(_rewardsDistribution),
            tokenState.balanceOf(address(_rewardsDistribution)).add(amountToDistribute)
        );
        emitTransfer(address(this), address(_rewardsDistribution), amountToDistribute);

        // Kick off the distribution of rewards
        _rewardsDistribution.distributeRewards(amountToDistribute);

        // Assign the minters reward.
        tokenState.setBalanceOf(msg.sender, tokenState.balanceOf(msg.sender).add(minterReward));
        emitTransfer(address(this), msg.sender, minterReward);

        totalSupply = totalSupply.add(supplyToMint);

        return true;
    }

    function mint(address _user, uint _amount) external optionalProxy returns (bool) {
        require(minterRole != address(0), "Mint is not available");
        require(minterRole == messageSender, "Caller is not minter");

        // It won't change totalsupply since it is only for bridge purpose.
        tokenState.setBalanceOf(_user, tokenState.balanceOf(_user).add(_amount));

        emitTransfer(address(0), _user, _amount);

        return true;
    }

    function liquidateDelinquentAccount(address account, uint pusdAmount)
        external
        systemActive
        optionalProxy
        blacklisted(messageSender)
        returns (bool)
    {
        (uint totalRedeemed, uint amountLiquidated) =
            issuer().liquidateDelinquentAccount(account, pusdAmount, messageSender);

        emitAccountLiquidated(account, totalRedeemed, amountLiquidated, messageSender);

        // Transfer PERI redeemed to messageSender
        // Reverts if amount to redeem is more than balanceOf account, ie due to escrowed balance
        return _transferByProxy(account, messageSender, totalRedeemed);
    }

    // ------------- Bridge Experiment
    function overchainTransfer(
        uint _amount,
        uint _destChainId,
        IBridgeState.Signature calldata _sign
    ) external payable optionalProxy {
        require(_amount > 0, "Can't transfer zero");
        (uint transferable, ) =
            issuer().transferablePeriFinanceAndAnyRateIsInvalid(messageSender, tokenState.balanceOf(messageSender));
        require(transferable >= _amount, "Can't transfer more than the transferrable");

        require(msg.value >= systemSettings().bridgeTransferGasCost(), "Fee is not sufficient");
        bridgeValidator.transfer(msg.value);

        require(_burnByProxy(messageSender, _amount), "burning failed");

        bridgeState.appendOutboundingRequest(messageSender, _amount, _destChainId, _sign);
    }

    function claimAllBridgedAmounts() external payable optionalProxy {
        uint[] memory applicableIds = bridgeState.applicableInboundIds(messageSender);

        require(applicableIds.length > 0, "No claimable");
        require(msg.value >= systemSettings().bridgeClaimGasCost(), "Fee is not sufficient");
        bridgeValidator.transfer(msg.value);

        for (uint i; i < applicableIds.length; i++) {
            _claimBridgedAmount(applicableIds[i]);
        }
    }

    function _claimBridgedAmount(uint _index) internal returns (bool) {
        // Validations are checked from bridge state
        (address account, uint amount, , , , ) = bridgeState.inboundings(_index);

        require(account == messageSender, "Caller is not matched");

        bridgeState.claimInbound(_index, amount);

        require(_mintByProxy(account, amount), "Mint failed");

        return true;
    }

    function setMinterRole(address _newMinter) external onlyOwner {
        // If address is set to zero address, mint is not prohibited
        minterRole = _newMinter;
    }

    function setBridgeValidator(address payable _bridgeValidator) external onlyOwner {
        bridgeValidator = _bridgeValidator;
    }

    function setInflationMinter(address _newInflationMinter) external onlyOwner {
        inflationMinter = _newInflationMinter;
    }

    function setBridgeState(address _newBridgeState) external onlyOwner {
        bridgeState = IBridgeState(_newBridgeState);
    }

    // ========== EVENTS ==========
    event AccountLiquidated(address indexed account, uint periRedeemed, uint amountLiquidated, address liquidator);
    bytes32 internal constant ACCOUNTLIQUIDATED_SIG = keccak256("AccountLiquidated(address,uint256,uint256,address)");

    function emitAccountLiquidated(
        address account,
        uint256 periRedeemed,
        uint256 amountLiquidated,
        address liquidator
    ) internal {
        proxy._emit(
            abi.encode(periRedeemed, amountLiquidated, liquidator),
            2,
            ACCOUNTLIQUIDATED_SIG,
            addressToBytes32(account),
            0,
            0
        );
    }
}
