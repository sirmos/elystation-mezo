// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ElyMarketV2
/// @notice Profiles, handles, services and pay-when-done deals in MUSD,
/// with disputes. A deal holds the customer's money in this contract until
/// the customer releases it, the review time ends after delivery, a referee
/// rules on a dispute, or the money is refunded.
/// The owner can change settings but cannot move money held in deals.
contract ElyMarketV2 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Delivered,
        Released,
        Refunded,
        Disputed,
        Resolved
    }

    struct ProfileInput {
        string name;
        string headline;
        string category;
        string city;
        string bio;
        string contact;
    }

    struct Profile {
        string name;
        string headline;
        string category;
        string city;
        string bio;
        string contact;
        uint64 updatedAt;
    }

    struct Service {
        string title;
        uint256 price;
        bool active;
    }

    struct Deal {
        address customer;
        address provider;
        uint256 amount;
        uint64 deadline;
        uint64 reviewSeconds;
        uint64 reviewEnds;
        uint64 resolveBy;
        Status status;
        string title;
    }

    uint256 public constant MAX_SERVICES = 8;
    uint16 public constant MAX_FEE_BPS = 100; // 1%
    uint64 public constant MAX_DEADLINE = 90 days;

    IERC20 public immutable usdc;
    address public treasury;
    address public referee;
    uint16 public feeBps;
    uint64 public minReview;
    uint64 public maxReview;
    uint64 public resolveWindow;

    IERC20 public discountToken;
    uint256 public discountMinBalance;
    uint16 public discountFeeBps;

    mapping(address => Profile) public profiles;
    mapping(address => Service[]) private _services;
    mapping(address => uint32) public jobsCompleted;
    mapping(address => uint256) public totalEarned;
    mapping(address => uint32) public disputesOpened;
    mapping(address => uint32) public disputesLost;

    mapping(address => string) public handleOf;
    mapping(bytes32 => address) public handleOwner;

    uint256 public nextDealId = 1;
    mapping(uint256 => Deal) public deals;

    event ProfileSet(
        address indexed provider,
        string name,
        string headline,
        string category,
        string city
    );
    event HandleSet(address indexed owner, string handle);
    event ServiceAdded(address indexed provider, uint256 index, string title, uint256 price);
    event ServiceStatus(address indexed provider, uint256 index, bool active);
    event DealCreated(
        uint256 indexed id,
        address indexed customer,
        address indexed provider,
        uint256 amount,
        uint64 deadline,
        string title
    );
    event DealDelivered(uint256 indexed id, uint64 reviewEnds);
    event DealReleased(uint256 indexed id, address indexed provider, uint256 net, uint256 fee);
    event DealRefunded(uint256 indexed id, address indexed customer, uint256 amount);
    event DisputeOpened(uint256 indexed id, address indexed customer, string reason);
    event EvidenceAdded(uint256 indexed id, address indexed by, string note);
    event DisputeResolved(
        uint256 indexed id,
        uint16 providerShareBps,
        uint256 providerNet,
        uint256 customerAmount,
        string ruling
    );
    event FeeChanged(uint16 feeBps);
    event TreasuryChanged(address treasury);
    event RefereeChanged(address referee);
    event ReviewBoundsChanged(uint64 minReview, uint64 maxReview);
    event ResolveWindowChanged(uint64 resolveWindow);
    event DiscountChanged(address token, uint256 minBalance, uint16 feeBps);

    constructor(
        address _usdc,
        address _treasury,
        uint16 _feeBps
    ) Ownable(msg.sender) {
        require(_usdc != address(0) && _treasury != address(0), "Zero address");
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        usdc = IERC20(_usdc);
        treasury = _treasury;
        feeBps = _feeBps;
        referee = msg.sender;
        minReview = 60;
        maxReview = 14 days;
        resolveWindow = 14 days;
    }

    // Profiles, handles and services

    function setProfile(ProfileInput calldata p) external {
        require(bytes(p.name).length > 0 && bytes(p.name).length <= 60, "Name length");
        require(bytes(p.headline).length <= 100, "Headline too long");
        require(
            bytes(p.category).length > 0 && bytes(p.category).length <= 32,
            "Category length"
        );
        require(bytes(p.city).length <= 60, "City too long");
        require(bytes(p.bio).length <= 400, "Bio too long");
        require(bytes(p.contact).length <= 80, "Contact too long");

        profiles[msg.sender] = Profile({
            name: p.name,
            headline: p.headline,
            category: p.category,
            city: p.city,
            bio: p.bio,
            contact: p.contact,
            updatedAt: uint64(block.timestamp)
        });

        emit ProfileSet(msg.sender, p.name, p.headline, p.category, p.city);
    }

    /// @notice Claim a unique handle: 3 to 20 characters, a to z, 0 to 9, underscore.
    /// A wallet has one handle. Claiming a new one frees the old one.
    function claimHandle(string calldata handle) external {
        require(profiles[msg.sender].updatedAt != 0, "Create a profile first");
        bytes memory b = bytes(handle);
        require(_validHandle(b), "Bad handle");

        bytes32 key = keccak256(b);
        address current = handleOwner[key];
        require(current == address(0) || current == msg.sender, "Handle taken");

        string memory old = handleOf[msg.sender];
        if (bytes(old).length > 0) {
            delete handleOwner[keccak256(bytes(old))];
        }

        handleOwner[key] = msg.sender;
        handleOf[msg.sender] = handle;
        emit HandleSet(msg.sender, handle);
    }

    function _validHandle(bytes memory h) private pure returns (bool) {
        if (h.length < 3 || h.length > 20) return false;
        for (uint256 i = 0; i < h.length; i++) {
            bytes1 c = h[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) return false;
        }
        return true;
    }

    function addService(string calldata title, uint256 price) external {
        require(profiles[msg.sender].updatedAt != 0, "Create a profile first");
        require(_services[msg.sender].length < MAX_SERVICES, "Too many services");
        require(bytes(title).length > 0 && bytes(title).length <= 80, "Title length");
        require(price > 0, "Price is zero");

        _services[msg.sender].push(Service({title: title, price: price, active: true}));
        emit ServiceAdded(msg.sender, _services[msg.sender].length - 1, title, price);
    }

    function setServiceActive(uint256 index, bool active) external {
        require(index < _services[msg.sender].length, "No such service");
        _services[msg.sender][index].active = active;
        emit ServiceStatus(msg.sender, index, active);
    }

    function getServices(address provider) external view returns (Service[] memory) {
        return _services[provider];
    }

    // Deals

    /// @notice Pay into the contract. The customer must approve MUSD first
    /// and chooses how long they will have to review the job after delivery.
    function createDeal(
        address provider,
        uint256 amount,
        string memory title,
        uint64 deadline,
        uint64 reviewSeconds
    ) external nonReentrant returns (uint256 id) {
        require(provider != address(0) && provider != msg.sender, "Bad provider");
        require(amount > 0, "Amount is zero");
        require(bytes(title).length <= 100, "Title too long");
        require(
            deadline > block.timestamp && deadline <= block.timestamp + MAX_DEADLINE,
            "Bad deadline"
        );
        require(reviewSeconds >= minReview && reviewSeconds <= maxReview, "Bad review time");

        id = nextDealId++;
        {
            Deal storage d = deals[id];
            d.customer = msg.sender;
            d.provider = provider;
            d.amount = amount;
            d.deadline = deadline;
            d.reviewSeconds = reviewSeconds;
            d.status = Status.Funded;
            d.title = title;
        }

        emit DealCreated(id, msg.sender, provider, amount, deadline, title);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice The provider says the job is done. The review time starts.
    function markDelivered(uint256 id) external {
        Deal storage d = deals[id];
        require(d.provider == msg.sender, "Not the provider");
        require(d.status == Status.Funded, "Not funded");

        d.status = Status.Delivered;
        d.reviewEnds = uint64(block.timestamp) + d.reviewSeconds;
        emit DealDelivered(id, d.reviewEnds);
    }

    /// @notice The customer confirms the job and the provider is paid.
    /// This also works during a dispute, and ends it.
    function release(uint256 id) external nonReentrant {
        Deal storage d = deals[id];
        require(d.customer == msg.sender, "Not the customer");
        require(
            d.status == Status.Funded ||
                d.status == Status.Delivered ||
                d.status == Status.Disputed,
            "Not open"
        );
        _payProvider(id, d);
    }

    /// @notice After the review time, anyone can pay out a delivered job
    /// that has no dispute.
    function claimAfterReview(uint256 id) external nonReentrant {
        Deal storage d = deals[id];
        require(d.status == Status.Delivered, "Not delivered");
        require(block.timestamp >= d.reviewEnds, "Review window is open");
        _payProvider(id, d);
    }

    /// @notice The provider can refund any open deal, including a disputed one.
    /// The customer can refund a deal that was never delivered once the
    /// deadline has passed.
    function refund(uint256 id) external nonReentrant {
        Deal storage d = deals[id];
        bool open = d.status == Status.Funded ||
            d.status == Status.Delivered ||
            d.status == Status.Disputed;
        bool byProvider = msg.sender == d.provider && open;
        bool byCustomer = msg.sender == d.customer &&
            d.status == Status.Funded &&
            block.timestamp > d.deadline;
        require(byProvider || byCustomer, "Refund not allowed");

        d.status = Status.Refunded;
        emit DealRefunded(id, d.customer, d.amount);
        usdc.safeTransfer(d.customer, d.amount);
    }

    // Disputes

    /// @notice The customer says the job is not done properly.
    /// Only possible after delivery and before the review time ends.
    function openDispute(uint256 id, string calldata reason) external {
        Deal storage d = deals[id];
        require(d.customer == msg.sender, "Not the customer");
        require(d.status == Status.Delivered, "Not delivered");
        require(block.timestamp < d.reviewEnds, "Review window is over");
        require(bytes(reason).length > 0 && bytes(reason).length <= 300, "Reason length");

        d.status = Status.Disputed;
        d.resolveBy = uint64(block.timestamp) + resolveWindow;
        disputesOpened[msg.sender] += 1;
        emit DisputeOpened(id, msg.sender, reason);
    }

    /// @notice Either side adds a short note or a link during a dispute.
    function addEvidence(uint256 id, string calldata note) external {
        Deal storage d = deals[id];
        require(d.status == Status.Disputed, "No open dispute");
        require(msg.sender == d.customer || msg.sender == d.provider, "Not in this deal");
        require(bytes(note).length > 0 && bytes(note).length <= 300, "Note length");
        emit EvidenceAdded(id, msg.sender, note);
    }

    /// @notice The referee decides how much of the money the provider gets.
    /// The fee applies only to the provider's part.
    function resolve(
        uint256 id,
        uint16 providerShareBps,
        string calldata ruling
    ) external nonReentrant {
        require(msg.sender == referee, "Not the referee");
        Deal storage d = deals[id];
        require(d.status == Status.Disputed, "No open dispute");
        require(msg.sender != d.customer && msg.sender != d.provider, "Referee has a conflict");
        require(providerShareBps <= 10_000, "Bad share");
        require(bytes(ruling).length <= 300, "Ruling too long");
        _resolve(id, d, providerShareBps, ruling);
    }

    /// @notice If the referee does not decide in time, anyone can split the
    /// money in half so it never stays stuck.
    function resolveAfterTimeout(uint256 id) external nonReentrant {
        Deal storage d = deals[id];
        require(d.status == Status.Disputed, "No open dispute");
        require(block.timestamp >= d.resolveBy, "Referee still has time");
        _resolve(id, d, 5000, "No ruling in time. Split in half.");
    }

    function _resolve(
        uint256 id,
        Deal storage d,
        uint16 share,
        string memory ruling
    ) private {
        if (share > 5000) {
            disputesLost[d.customer] += 1;
            jobsCompleted[d.provider] += 1;
        } else if (share < 5000) {
            disputesLost[d.provider] += 1;
        }

        uint256 providerAmount = (d.amount * share) / 10_000;
        uint256 customerAmount = d.amount - providerAmount;
        (uint256 net, ) = _finish(d, providerAmount, Status.Resolved);
        emit DisputeResolved(id, share, net, customerAmount, ruling);
    }

    // Payout helpers

    function _payProvider(uint256 id, Deal storage d) private {
        jobsCompleted[d.provider] += 1;
        (uint256 net, uint256 fee) = _finish(d, d.amount, Status.Released);
        emit DealReleased(id, d.provider, net, fee);
    }

    /// @dev Sets the final status first, then moves the money.
    function _finish(
        Deal storage d,
        uint256 providerAmount,
        Status finalStatus
    ) private returns (uint256 net, uint256 fee) {
        d.status = finalStatus;
        uint256 customerAmount = d.amount - providerAmount;
        fee = (providerAmount * _feeFor(d.provider)) / 10_000;
        net = providerAmount - fee;
        totalEarned[d.provider] += net;

        if (fee > 0) usdc.safeTransfer(treasury, fee);
        if (net > 0) usdc.safeTransfer(d.provider, net);
        if (customerAmount > 0) usdc.safeTransfer(d.customer, customerAmount);
    }

    function _feeFor(address provider) private view returns (uint256) {
        if (address(discountToken) == address(0)) return feeBps;
        try discountToken.balanceOf(provider) returns (uint256 balance) {
            if (balance >= discountMinBalance) return discountFeeBps;
        } catch {}
        return feeBps;
    }

    // Owner settings. None of these can move money held in deals.

    function setFee(uint16 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        feeBps = _feeBps;
        emit FeeChanged(_feeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        treasury = _treasury;
        emit TreasuryChanged(_treasury);
    }

    /// @notice Use a shared wallet or a panel address here as the team grows.
    function setReferee(address _referee) external onlyOwner {
        require(_referee != address(0), "Zero address");
        referee = _referee;
        emit RefereeChanged(_referee);
    }

    function setReviewBounds(uint64 _min, uint64 _max) external onlyOwner {
        require(_min >= 60 && _max <= 30 days && _min <= _max, "Bad bounds");
        minReview = _min;
        maxReview = _max;
        emit ReviewBoundsChanged(_min, _max);
    }

    function setResolveWindow(uint64 _window) external onlyOwner {
        require(_window >= 60 && _window <= 60 days, "Bad window");
        resolveWindow = _window;
        emit ResolveWindowChanged(_window);
    }

    /// @notice Providers holding at least `minBalance` of `token` pay `bps`.
    /// Use the zero address to turn the discount off.
    function setDiscount(address token, uint256 minBalance, uint16 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "Fee too high");
        // No code-size check: MEZO on Mezo is a built-in token (precompile).
        // Reads are wrapped in try/catch in _feeFor, so a bad address cannot block payouts.
        discountToken = IERC20(token);
        discountMinBalance = minBalance;
        discountFeeBps = bps;
        emit DiscountChanged(token, minBalance, bps);
    }
}