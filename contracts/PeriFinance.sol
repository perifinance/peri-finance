pragma solidity 0.5.16;

// Inheritance
import "./BasePeriFinance.sol";

// Internal references
import "./interfaces/IRewardEscrow.sol";
import "./interfaces/IRewardEscrowV2.sol";
import "./interfaces/ISupplySchedule.sol";
import "./interfaces/IBridgeState.sol";

// https://docs.peri.finance/contracts/source/contracts/periFinance
contract PeriFinance is BasePeriFinance {
    // ========== ADDRESS RESOLVER CONFIGURATION ==========
    bytes32 private constant CONTRACT_REWARD_ESCROW = "RewardEscrow";
    bytes32 private constant CONTRACT_REWARDESCROW_V2 = "RewardEscrowV2";
    bytes32 private constant CONTRACT_SUPPLYSCHEDULE = "SupplySchedule";

    address public minterRole;
    address public inflationMinter;

    IBridgeState public bridgeState;

    // ========== CONSTRUCTOR ==========

    constructor(
        address payable _proxy,
        TokenState _tokenState,
        address _owner,
        uint _totalSupply,
        address _resolver,
        address _minterRole,
        address _blacklistManager
    ) public BasePeriFinance(_proxy, _tokenState, _owner, _totalSupply, _resolver, _blacklistManager) {
        minterRole = _minterRole;
    }

    function resolverAddressesRequired() public view returns (bytes32[] memory addresses) {
        bytes32[] memory existingAddresses = BasePeriFinance.resolverAddressesRequired();
        bytes32[] memory newAddresses = new bytes32[](3);
        newAddresses[0] = CONTRACT_REWARD_ESCROW;
        newAddresses[1] = CONTRACT_REWARDESCROW_V2;
        newAddresses[2] = CONTRACT_SUPPLYSCHEDULE;
        return combineArrays(existingAddresses, newAddresses);
    }

    // ========== VIEWS ==========

    function rewardEscrow() internal view returns (IRewardEscrow) {
        return IRewardEscrow(requireAndGetAddress(CONTRACT_REWARD_ESCROW));
    }

    function rewardEscrowV2() internal view returns (IRewardEscrowV2) {
        return IRewardEscrowV2(requireAndGetAddress(CONTRACT_REWARDESCROW_V2));
    }

    function supplySchedule() internal view returns (ISupplySchedule) {
        return ISupplySchedule(requireAndGetAddress(CONTRACT_SUPPLYSCHEDULE));
    }

    // ========== OVERRIDDEN FUNCTIONS ==========

    function exchangeWithVirtual(
        bytes32 sourceCurrencyKey,
        uint sourceAmount,
        bytes32 destinationCurrencyKey,
        bytes32 trackingCode
    )
        external
        exchangeActive(sourceCurrencyKey, destinationCurrencyKey)
        optionalProxy
        blacklisted(messageSender)
        returns (uint amountReceived, IVirtualPynth vPynth)
    {
        _notImplemented();
        return
            exchanger().exchangeWithVirtual(
                messageSender,
                sourceCurrencyKey,
                sourceAmount,
                destinationCurrencyKey,
                messageSender,
                trackingCode
            );
    }

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
        _notImplemented();
        return exchanger().settle(messageSender, currencyKey);
    }

    function inflationalMint(uint _networkDebtShare) external issuanceActive returns (bool) {
        require(msg.sender == inflationMinter, "Not allowed to mint");
        require(SafeDecimalMath.unit() >= _networkDebtShare, "Invalid network debt share");
        require(address(rewardsDistribution()) != address(0), "RewardsDistribution not set");

        ISupplySchedule _supplySchedule = supplySchedule();
        IRewardsDistribution _rewardsDistribution = rewardsDistribution();

        uint supplyToMint = _supplySchedule.mintableSupply();
        supplyToMint = supplyToMint.multiplyDecimal(_networkDebtShare);
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
        require(minterRole == messageSender, "Caller is not allowed to mint");

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
        _notImplemented();

        (uint totalRedeemed, uint amountLiquidated) =
            issuer().liquidateDelinquentAccount(account, pusdAmount, messageSender);

        emitAccountLiquidated(account, totalRedeemed, amountLiquidated, messageSender);

        // Transfer PERI redeemed to messageSender
        // Reverts if amount to redeem is more than balanceOf account, ie due to escrowed balance
        return _transferByProxy(account, messageSender, totalRedeemed);
    }

    // ------------- Bridge Experiment
    function overchainTransfer(uint _amount, uint _destChainId) external optionalProxy onlyTester {
        require(_amount > 0, "Cannot transfer zero");

        require(_burnByProxy(messageSender, _amount), "burning failed");

        bridgeState.appendOutboundingRequest(messageSender, _amount, _destChainId);
    }

    function claimAllBridgedAmounts() external optionalProxy onlyTester {
        uint[] memory applicableIds = bridgeState.applicableInboundIds(messageSender);

        require(applicableIds.length > 0, "No claimable");

        for (uint i = 0; i < applicableIds.length; i++) {
            _claimBridgedAmount(applicableIds[i]);
        }
    }

    function claimBridgedAmount(uint _index) external optionalProxy onlyTester {
        _claimBridgedAmount(_index);
    }

    function _claimBridgedAmount(uint _index) internal returns (bool) {
        // Validations are checked from bridge state
        (address account, uint amount, , , ) = bridgeState.inboundings(_index);

        require(account == messageSender, "Caller is not matched");

        bridgeState.claimInbound(_index);

        require(_mintByProxy(account, amount), "Mint failed");

        return true;
    }

    modifier onlyTester() {
        require(address(bridgeState) != address(0), "BridgeState is not set");

        bytes32 tester = "Tester";

        require(bridgeState.isOnRole(tester, messageSender), "Not tester");
        _;
    }

    /* Once off function for SIP-60 to migrate PERI balances in the RewardEscrow contract
     * To the new RewardEscrowV2 contract
     */
    function migrateEscrowBalanceToRewardEscrowV2() external onlyOwner {
        // Record balanceOf(RewardEscrow) contract
        uint rewardEscrowBalance = tokenState.balanceOf(address(rewardEscrow()));

        // transfer all of RewardEscrow's balance to RewardEscrowV2
        // _internalTransfer emits the transfer event
        _internalTransfer(address(rewardEscrow()), address(rewardEscrowV2()), rewardEscrowBalance);
    }

    function setMinterRole(address _newMinter) external onlyOwner {
        // If address is set to zero address, mint is not prohibited
        minterRole = _newMinter;
    }

    function setinflationMinter(address _newinflationMinter) external onlyOwner {
        inflationMinter = _newinflationMinter;
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
