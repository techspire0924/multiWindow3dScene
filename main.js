import WindowManager from './WindowManager.js'



const t = THREE;
let camera, scene, renderer, world;
let near, far;
let pixR = window.devicePixelRatio ? window.devicePixelRatio : 1;
let windowSpheres = [];
let orbiters = [];
let lastRenderTime = 0;
const ORBITER_COUNT = 800;
const ORBITER_MIN_DISTANCE = 50;
const ORBITER_MAX_DISTANCE = 250;
let sceneOffsetTarget = {x: 0, y: 0};
let sceneOffset = {x: 0, y: 0};

let today = new Date();
today.setHours(0);
today.setMinutes(0);
today.setSeconds(0);
today.setMilliseconds(0);
today = today.getTime();

let internalTime = getTime();
let windowManager;
let initialized = false;
let previousWindowCount = 0;
let lastSaveTime = 0;
const SAVE_INTERVAL = 0.2; // Save to localStorage every 0.1 seconds for better position syncing

// get time in seconds since beginning of the day (so that all windows use the same time)
function getTime ()
{
	return (new Date().getTime() - today) / 1000.0;
}


if (new URLSearchParams(window.location.search).get("clear"))
{
	localStorage.clear();
}
else
{	
	// this code is essential to circumvent that some browsers preload the content of some pages before you actually hit the url
	document.addEventListener("visibilitychange", () => 
	{
		if (document.visibilityState != 'hidden' && !initialized)
		{
			init();
		}
	});

	window.onload = () => {
		if (document.visibilityState != 'hidden')
		{
			init();
		}
	};

	function init ()
	{
		initialized = true;

		// add a short timeout because window.offsetX reports wrong values before a short period 
		setTimeout(() => {
			setupScene();
			setupWindowManager();
			resize();
			updateWindowShape(false);
			render();
			window.addEventListener('resize', resize);
			
			// Listen for storage changes to sync positions in real-time across windows
			window.addEventListener('storage', (e) => {
				if (e.key === 'orbitersData' && orbiters.length > 0) {
					// Sync positions from localStorage when it changes
					try {
						const saved = localStorage.getItem("orbitersData");
						if (saved) {
							const savedOrbitersData = JSON.parse(saved);
							for (let i = 0; i < orbiters.length && i < savedOrbitersData.length; i++)
							{
								if (savedOrbitersData[i] && savedOrbitersData[i].position)
								{
									// Sync position from localStorage
									orbiters[i].mesh.position.set(
										savedOrbitersData[i].position.x,
										savedOrbitersData[i].position.y,
										savedOrbitersData[i].position.z
									);
									// Also sync other state
									if (savedOrbitersData[i].theta !== undefined) orbiters[i].theta = savedOrbitersData[i].theta;
									if (savedOrbitersData[i].phi !== undefined) orbiters[i].phi = savedOrbitersData[i].phi;
									if (savedOrbitersData[i].isMoving !== undefined) orbiters[i].isMoving = savedOrbitersData[i].isMoving;
									if (savedOrbitersData[i].center) {
										orbiters[i].center.x = savedOrbitersData[i].center.x;
										orbiters[i].center.y = savedOrbitersData[i].center.y;
									}
								}
							}
						}
					} catch (err) {
						console.warn("Failed to sync from storage event", err);
					}
				}
			});
		}, 500)	
	}

	function setupScene ()
	{
		camera = new t.OrthographicCamera(0, 0, window.innerWidth, window.innerHeight, -10000, 10000);
		
		camera.position.z = 2.5;
		near = camera.position.z - .5;
		far = camera.position.z + 0.5;

		scene = new t.Scene();
		scene.background = new t.Color(0.0);
		scene.add( camera );

		renderer = new t.WebGLRenderer({antialias: true, depthBuffer: true});
		renderer.setPixelRatio(pixR);
	    
	  	world = new t.Object3D();
		scene.add(world);
		// Don't create orbiters here - wait until first sphere exists
		// Orbiters will be created in windowsUpdated when first window appears

		renderer.domElement.setAttribute("id", "scene");
		document.body.appendChild( renderer.domElement );
	}

	function createSharedOrbiters ()
	{
		// Check if orbiters have already been created in this window
		if (orbiters.length > 0) {
			// Orbiters already exist in this window, don't create again
			return;
		}

		// Try to load orbiters' data from localStorage (for backward compatibility)
		let savedOrbitersData = null;
		try {
			const saved = localStorage.getItem("orbitersData");
			if (saved) {
				savedOrbitersData = JSON.parse(saved);
			}
		} catch (e) {
			console.warn("Failed to load orbiters data from localStorage", e);
		}

		const geometry = new t.SphereGeometry(1, 6, 6);
		for (let i = 0; i < ORBITER_COUNT; i++)
		{
			const material = new t.MeshBasicMaterial({
				color: new t.Color().setHSL(1 / ORBITER_COUNT * i, 0.8, 0.6),
				wireframe: true,
				opacity: 0.4,
				transparent: true
			});

			const mesh = new t.Mesh(geometry, material);
			const distance = ORBITER_MIN_DISTANCE + Math.random() * (ORBITER_MAX_DISTANCE - ORBITER_MIN_DISTANCE);
			const theta = Math.random() * Math.PI * 2;
			const phi = 0.2 + Math.random() * (Math.PI - 0.4);
			const thetaSpeed = 0.03 + Math.random() * 0.2;
			const phiSpeed = 0.02 + Math.random() * 0.1;
			const phiDirection = Math.random() < 0.5 ? -1 : 1;
			const scale = 0.05 + Math.random() * 0.1;
			const centerMoveSpeed = 0.05 + Math.random() * 0.3;

			mesh.scale.set(scale, scale, scale);
			mesh.position.set(0, 0, 0);

			world.add(mesh);
			
			// Load saved target sphere index if available, otherwise default to 0 (first sphere)
			let savedData = savedOrbitersData && savedOrbitersData[i] ? savedOrbitersData[i] : null;
			orbiters.push({
				mesh,
				radius: distance,
				theta,
				phi,
				thetaSpeed,
				phiSpeed,
				phiDirection,
				targetSphereIndex: savedData && savedData.targetSphereIndex !== undefined ? savedData.targetSphereIndex : 0,
				lastTargetIndex: -1, // Track when target changes
				center: {x: 0, y: 0}, // Current center position (updated dynamically)
				intermediateTarget: null, // Random intermediate target when target changes
				centerInitialized: false, // Track if center has been initialized (only once)
				centerMoveSpeed,
				scale: scale, // Store scale for sharing
				isMoving: false, // Flag to track if sphere is moving to targetPos
				targetPos: null, // Target position when isMoving is true
				targetPosCenter: null // The center position used when targetPos was calculated
			});
		}
	}

	function saveOrbitersTargetSpheresToLocalStorage ()
	{
		try {
			const orbitersData = orbiters.map(orbiter => ({
				targetSphereIndex: orbiter.targetSphereIndex,
				radius: orbiter.radius,
				theta: orbiter.theta,
				phi: orbiter.phi,
				thetaSpeed: orbiter.thetaSpeed,
				phiSpeed: orbiter.phiSpeed,
				phiDirection: orbiter.phiDirection,
				centerMoveSpeed: orbiter.centerMoveSpeed,
				center: {x: orbiter.center.x, y: orbiter.center.y},
				scale: orbiter.scale,
				isMoving: orbiter.isMoving,
				targetPos: orbiter.targetPos ? {x: orbiter.targetPos.x, y: orbiter.targetPos.y, z: orbiter.targetPos.z} : null,
				targetPosCenter: orbiter.targetPosCenter ? {x: orbiter.targetPosCenter.x, y: orbiter.targetPosCenter.y} : null,
				position: {x: orbiter.mesh.position.x, y: orbiter.mesh.position.y, z: orbiter.mesh.position.z}
			}));
			localStorage.setItem("orbitersData", JSON.stringify(orbitersData));
		} catch (e) {
			console.warn("Failed to save orbiters data to localStorage", e);
		}
	}

	function loadOrbitersFromLocalStorage ()
	{
		// Check if orbiters have already been created in this window
		if (orbiters.length > 0) {
			return;
		}

		try {
			const saved = localStorage.getItem("orbitersData");
			if (!saved) {
				// No saved data, can't load orbiters
				return;
			}

			const savedOrbitersData = JSON.parse(saved);
			if (!savedOrbitersData || savedOrbitersData.length === 0) {
				return;
			}

			const geometry = new t.SphereGeometry(1, 6, 6);
			for (let i = 0; i < savedOrbitersData.length; i++)
			{
				const savedData = savedOrbitersData[i];
				if (!savedData) continue;

				const material = new t.MeshBasicMaterial({
					color: new t.Color().setHSL(i / ORBITER_COUNT * i, 0.8, 0.6),
					wireframe: true,
					opacity: 0.4,
					transparent: true
				});

				const scale = savedData.scale || (0.05 + Math.random() * 0.1);
				const mesh = new t.Mesh(geometry, material);
				mesh.scale.set(scale, scale, scale);
				mesh.position.set(0, 0, 0);

				world.add(mesh);
				
				const loadedCenter = savedData.center ? {x: savedData.center.x, y: savedData.center.y} : {x: 0, y: 0};
				const loadedRadius = savedData.radius || (ORBITER_MIN_DISTANCE + Math.random() * (ORBITER_MAX_DISTANCE - ORBITER_MIN_DISTANCE));
				const loadedTheta = savedData.theta || (Math.random() * Math.PI * 2);
				const loadedPhi = savedData.phi || (0.2 + Math.random() * (Math.PI - 0.4));
				const loadedIsMoving = savedData.isMoving !== undefined ? savedData.isMoving : false;
				const loadedTargetPos = savedData.targetPos ? {x: savedData.targetPos.x, y: savedData.targetPos.y, z: savedData.targetPos.z} : null;
				
				// Check if center is valid (not at origin, which means it wasn't properly initialized)
				const centerIsValid = !(loadedCenter.x === 0 && loadedCenter.y === 0);
				
				// Use saved position if available (most accurate), otherwise calculate from state
				let initialX, initialY, initialZ;
				if (savedData.position)
				{
					// Use the saved position directly (most accurate for syncing across windows)
					initialX = savedData.position.x;
					initialY = savedData.position.y;
					initialZ = savedData.position.z;
				}
				else
				{
					// Fallback: calculate position from saved state
					if (loadedIsMoving && loadedTargetPos && centerIsValid)
					{
						initialX = loadedTargetPos.x;
						initialY = loadedTargetPos.y;
						initialZ = loadedTargetPos.z;
					}
					else if (centerIsValid)
					{
						const sinPhi = Math.sin(loadedPhi);
						const cosPhi = Math.cos(loadedPhi);
						initialX = loadedCenter.x + Math.cos(loadedTheta) * sinPhi * loadedRadius;
						initialY = loadedCenter.y + Math.sin(loadedTheta) * sinPhi * loadedRadius;
						initialZ = cosPhi * loadedRadius;
					}
					else
					{
						if (loadedTargetPos)
						{
							initialX = loadedTargetPos.x;
							initialY = loadedTargetPos.y;
							initialZ = loadedTargetPos.z;
						}
						else
						{
							initialX = 0;
							initialY = 0;
							initialZ = 0;
						}
					}
				}
				
				mesh.position.set(initialX, initialY, initialZ);
				
				orbiters.push({
					mesh,
					radius: loadedRadius,
					theta: loadedTheta,
					phi: loadedPhi,
					thetaSpeed: savedData.thetaSpeed || (0.03 + Math.random() * 0.2),
					phiSpeed: savedData.phiSpeed || (0.02 + Math.random() * 0.1),
					phiDirection: savedData.phiDirection !== undefined ? savedData.phiDirection : (Math.random() < 0.5 ? -1 : 1),
					targetSphereIndex: savedData.targetSphereIndex !== undefined ? savedData.targetSphereIndex : 0,
					lastTargetIndex: savedData.targetSphereIndex !== undefined ? savedData.targetSphereIndex : -1,
					center: loadedCenter,
					intermediateTarget: null, // Will be set when target changes
					centerInitialized: centerIsValid, // Only initialized if center is valid (not at origin)
					centerMoveSpeed: savedData.centerMoveSpeed || (0.05 + Math.random() * 0.3),
					scale: scale,
					isMoving: loadedIsMoving,
					targetPos: loadedTargetPos,
					targetPosCenter: savedData.targetPosCenter ? {x: savedData.targetPosCenter.x, y: savedData.targetPosCenter.y} : null
				});
			}
		} catch (e) {
			console.warn("Failed to load orbiters from localStorage", e);
		}
	}

	function updateOrbiters (windowSpheres, deltaTime)
	{
		if (!orbiters.length || !windowSpheres.length) return;

		let targetSpheresChanged = false;

		for (let i = 0; i < orbiters.length; i++)
		{
			let orbiter = orbiters[i];
			
			// Get the target sphere index (default to last sphere if invalid)
			let targetIndex = orbiter.targetSphereIndex;
			if (targetIndex < 0 || targetIndex >= windowSpheres.length)
			{
				targetIndex = windowSpheres.length - 1;
				if (orbiter.targetSphereIndex !== targetIndex)
				{
					orbiter.targetSphereIndex = targetIndex;
					targetSpheresChanged = true;
				}
			}

			// Calculate the center of the target sphere in real-time
			let targetSphere = windowSpheres[targetIndex];
			if (!targetSphere) continue;
			
			let targetCenter = {
				x: targetSphere.position.x,
				y: targetSphere.position.y
			};

			// Initialize lastTargetIndex if not set (first time)
			if (orbiter.lastTargetIndex === -1)
			{
				orbiter.lastTargetIndex = targetIndex;
			}

			// Initialize center ONLY ONCE - when it hasn't been initialized yet
			// This handles the case when orbiters are created before windows exist
			if (!orbiter.centerInitialized && orbiter.center.x === 0 && orbiter.center.y === 0 && targetCenter.x !== 0 && targetCenter.y !== 0)
			{
				// First time initialization - set center to target
				orbiter.center.x = targetCenter.x;
				orbiter.center.y = targetCenter.y;
				orbiter.centerInitialized = true;
			}

			// Check if target changed - just track it, don't change center position
			if (orbiter.lastTargetIndex !== targetIndex)
			{
				// Target changed - clear any intermediate target and let orbiter move from current position
				// DO NOT change center position - let it animate smoothly from current position
				orbiter.intermediateTarget = null;
				orbiter.lastTargetIndex = targetIndex;
				targetSpheresChanged = true;
			}

			// First, update the center to move toward target center (keep center synchronized with target sphere)
			const centerDx = targetCenter.x - orbiter.center.x;
			const centerDy = targetCenter.y - orbiter.center.y;
			const centerDistance = Math.hypot(centerDx, centerDy);

			// Move center toward target center smoothly
			if (centerDistance > 0.1)
			{
				const moveAmount = orbiter.centerMoveSpeed * deltaTime * 100 * 3;
				const t = Math.min(moveAmount / Math.max(centerDistance, 0.001), 1);
				orbiter.center.x += centerDx * t;
				orbiter.center.y += centerDy * t;
			}
			else
			{
				// Very close, sync with target
				orbiter.center.x = targetCenter.x;
				orbiter.center.y = targetCenter.y;
			}

			// Get current mesh position
			const currentPos = orbiter.mesh.position;
			const currentX = currentPos.x;
			const currentY = currentPos.y;
			const currentZ = currentPos.z;

			// Calculate distance from mesh position to center
			const posToCenterDx = currentX - orbiter.center.x;
			const posToCenterDy = currentY - orbiter.center.y;
			const posToCenterDz = currentZ;
			const distanceFromCenter = Math.hypot(posToCenterDx, posToCenterDy, posToCenterDz);

			// New movement algorithm
			if (!orbiter.isMoving)
			{
				// Check if target center has changed significantly (window moved)
				// If centerDistance is significant, switch to moving mode
				if (centerDistance > 0.1)
				{
					// Target center has changed - switch to moving mode
					// Calculate random targetPos at exactly distance 10 from the newly updated center (targetCenter)
					const targetDistance = 10; // Exactly 10 units
					const randomTheta = Math.random() * Math.PI * 2;
					const randomPhi = Math.random() * Math.PI;
					
					orbiter.targetPos = {
						x: targetCenter.x + Math.cos(randomTheta) * Math.sin(randomPhi) * targetDistance,
						y: targetCenter.y + Math.sin(randomTheta) * Math.sin(randomPhi) * targetDistance,
						z: Math.cos(randomPhi) * targetDistance
					};
					// Store the center that was used when calculating targetPos
					orbiter.targetPosCenter = {x: targetCenter.x, y: targetCenter.y};
					orbiter.isMoving = true;
				}
				else
				{
					// isMoving is false - rotate around center
					// Update rotation angles for orbital motion
					orbiter.theta += orbiter.thetaSpeed * deltaTime;
					orbiter.phi += orbiter.phiSpeed * deltaTime * orbiter.phiDirection;

					if (orbiter.phi <= 0.2 || orbiter.phi >= Math.PI - 0.2)
					{
						orbiter.phiDirection *= -1;
						orbiter.phi = Math.max(0.2, Math.min(Math.PI - 0.2, orbiter.phi));
					}

					// Calculate position on sphere surface around the center
					const sinPhi = Math.sin(orbiter.phi);
					const cosPhi = Math.cos(orbiter.phi);
					const x = orbiter.center.x + Math.cos(orbiter.theta) * sinPhi * orbiter.radius;
					const y = orbiter.center.y + Math.sin(orbiter.theta) * sinPhi * orbiter.radius;
					const z = cosPhi * orbiter.radius;

					orbiter.mesh.position.set(x, y, z);

					// Recalculate distance from new position to center
					const newPosToCenterDx = x - orbiter.center.x;
					const newPosToCenterDy = y - orbiter.center.y;
					const newPosToCenterDz = z;
					const newDistanceFromCenter = Math.hypot(newPosToCenterDx, newPosToCenterDy, newPosToCenterDz);

					// Check distance from center - if > 150, start moving
					if (newDistanceFromCenter > ORBITER_MAX_DISTANCE)
					{
						// Calculate random targetPos at exactly distance 10 from the newly updated center (targetCenter)
						const targetDistance = 10; // Exactly 10 units
						const randomTheta = Math.random() * Math.PI * 2;
						const randomPhi = Math.random() * Math.PI;
						
						orbiter.targetPos = {
							x: targetCenter.x + Math.cos(randomTheta) * Math.sin(randomPhi) * targetDistance,
							y: targetCenter.y + Math.sin(randomTheta) * Math.sin(randomPhi) * targetDistance,
							z: Math.cos(randomPhi) * targetDistance
						};
						// Store the center that was used when calculating targetPos
						orbiter.targetPosCenter = {x: targetCenter.x, y: targetCenter.y};
						orbiter.isMoving = true;
					}
				}
			}
			else
			{
				// isMoving is true - move toward targetPos
				if (!orbiter.targetPos)
				{
					// No targetPos set, go back to rotating
					orbiter.isMoving = false;
				}
				else
				{
					// Check if target center has changed (window moved)
					// If so, update targetPos to maintain the same relative position from the new center
					if (orbiter.targetPosCenter)
					{
						const centerOffsetX = targetCenter.x - orbiter.targetPosCenter.x;
						const centerOffsetY = targetCenter.y - orbiter.targetPosCenter.y;
						
						// If center has moved significantly, update targetPos
						if (Math.abs(centerOffsetX) > 0.01 || Math.abs(centerOffsetY) > 0.01)
						{
							// Calculate the offset from the old center to targetPos
							const oldOffsetX = orbiter.targetPos.x - orbiter.targetPosCenter.x;
							const oldOffsetY = orbiter.targetPos.y - orbiter.targetPosCenter.y;
							const oldOffsetZ = orbiter.targetPos.z;
							const oldOffsetDistance = Math.hypot(oldOffsetX, oldOffsetY, oldOffsetZ);
							
							// Normalize the offset direction
							if (oldOffsetDistance > 0.001)
							{
								// Maintain the same direction but ensure distance is exactly 10 from new center
								const normalizedX = oldOffsetX / oldOffsetDistance;
								const normalizedY = oldOffsetY / oldOffsetDistance;
								const normalizedZ = oldOffsetZ / oldOffsetDistance;
								
								// Update targetPos to be at exactly distance 10 from new center in the same direction
								const targetDistance = 10; // Exactly 10 units
								orbiter.targetPos = {
									x: targetCenter.x + normalizedX * targetDistance,
									y: targetCenter.y + normalizedY * targetDistance,
									z: normalizedZ * targetDistance
								};
							}
							else
							{
								// If old offset is too small, recalculate random position at distance 10
								const targetDistance = 10; // Exactly 10 units
								const randomTheta = Math.random() * Math.PI * 2;
								const randomPhi = Math.random() * Math.PI;
								
								orbiter.targetPos = {
									x: targetCenter.x + Math.cos(randomTheta) * Math.sin(randomPhi) * targetDistance,
									y: targetCenter.y + Math.sin(randomTheta) * Math.sin(randomPhi) * targetDistance,
									z: Math.cos(randomPhi) * targetDistance
								};
							}
							
							// Update the stored center
							orbiter.targetPosCenter.x = targetCenter.x;
							orbiter.targetPosCenter.y = targetCenter.y;
						}
					}
					
					// Calculate direction to targetPos
					const toTargetDx = orbiter.targetPos.x - currentX;
					const toTargetDy = orbiter.targetPos.y - currentY;
					const toTargetDz = orbiter.targetPos.z - currentZ;
					const toTargetDistance = Math.hypot(toTargetDx, toTargetDy, toTargetDz);

					if (toTargetDistance > 0.5)
					{
						// Move toward targetPos
						const moveSpeed = orbiter.centerMoveSpeed * deltaTime * 100 * 3;
						const moveDistance = Math.min(moveSpeed, toTargetDistance);
						if (toTargetDistance > 0.001)
						{
							orbiter.mesh.position.set(
								currentX + (toTargetDx / toTargetDistance) * moveDistance,
								currentY + (toTargetDy / toTargetDistance) * moveDistance,
								currentZ + (toTargetDz / toTargetDistance) * moveDistance
							);
						}
					}
					else
					{
						// Arrived at targetPos - set isMoving to false and continue rotating
						orbiter.mesh.position.set(orbiter.targetPos.x, orbiter.targetPos.y, orbiter.targetPos.z);
						orbiter.isMoving = false;
						orbiter.targetPos = null;
						orbiter.targetPosCenter = null;
					}
				}
			}
			
			// Always rotate the mesh itself (visual rotation continues)
			orbiter.mesh.rotation.x += deltaTime * 0.2;
			orbiter.mesh.rotation.y += deltaTime * 0.3;
		}

		// Save to localStorage periodically (throttle to avoid too many writes)
		// Save when target changes or periodically to update center positions
		let currentTime = getTime();
		if (targetSpheresChanged || (currentTime - lastSaveTime >= SAVE_INTERVAL))
		{
			saveOrbitersTargetSpheresToLocalStorage();
			lastSaveTime = currentTime;
		}
	}

	function setupWindowManager ()
	{
		windowManager = new WindowManager();
		windowManager.setWinShapeChangeCallback(updateWindowShape);
		windowManager.setWinChangeCallback(windowsUpdated);

		// here you can add your custom metadata to each windows instance
		let metaData = {foo: "bar"};

		// this will init the windowmanager and add this window to the centralised pool of windows
		windowManager.init(metaData);

		// call update windows initially (it will later be called by the win change callback)
		windowsUpdated();
	}

	function windowsUpdated ()
	{
		let wins = windowManager.getWindows();
		let currentWindowCount = wins.length;
		
		// Always try to load orbiters from localStorage first if they don't exist in this window
		if (orbiters.length === 0)
		{
			// Try to load from localStorage
			loadOrbitersFromLocalStorage();
			
			// If loading failed (no data in localStorage) and this is the first window, create new orbiters
			if (orbiters.length === 0 && currentWindowCount === 1)
			{
				createSharedOrbiters();
				// Save orbiters data immediately after creation
				saveOrbitersTargetSpheresToLocalStorage();
			}
		}
		
		// Sync orbiters state from localStorage (so all windows stay in sync)
		// This ensures all windows have the latest state
		if (orbiters.length > 0)
		{
			try {
				const saved = localStorage.getItem("orbitersData");
				if (saved) {
					const savedOrbitersData = JSON.parse(saved);
					for (let i = 0; i < orbiters.length && i < savedOrbitersData.length; i++)
					{
						if (savedOrbitersData[i])
						{
							// Update all properties from localStorage to keep windows in sync
							if (savedOrbitersData[i].targetSphereIndex !== undefined)
							{
								orbiters[i].targetSphereIndex = savedOrbitersData[i].targetSphereIndex;
							}
							if (savedOrbitersData[i].theta !== undefined)
							{
								orbiters[i].theta = savedOrbitersData[i].theta;
							}
							if (savedOrbitersData[i].phi !== undefined)
							{
								orbiters[i].phi = savedOrbitersData[i].phi;
							}
							if (savedOrbitersData[i].isMoving !== undefined)
							{
								orbiters[i].isMoving = savedOrbitersData[i].isMoving;
							}
							if (savedOrbitersData[i].targetPos)
							{
								orbiters[i].targetPos = {
									x: savedOrbitersData[i].targetPos.x,
									y: savedOrbitersData[i].targetPos.y,
									z: savedOrbitersData[i].targetPos.z
								};
							}
							if (savedOrbitersData[i].targetPosCenter)
							{
								orbiters[i].targetPosCenter = {
									x: savedOrbitersData[i].targetPosCenter.x,
									y: savedOrbitersData[i].targetPosCenter.y
								};
							}
							// Sync position from localStorage (critical for accurate sharing across windows)
							if (savedOrbitersData[i].position)
							{
								orbiters[i].mesh.position.set(
									savedOrbitersData[i].position.x,
									savedOrbitersData[i].position.y,
									savedOrbitersData[i].position.z
								);
							}
							// Sync center from localStorage
							if (savedOrbitersData[i].center)
							{
								orbiters[i].center.x = savedOrbitersData[i].center.x;
								orbiters[i].center.y = savedOrbitersData[i].center.y;
							}
						}
					}
				}
			} catch (e) {
				console.warn("Failed to sync orbiters from localStorage", e);
			}
		}
		
		// Check if a new window was added
		if (currentWindowCount > previousWindowCount && currentWindowCount > 0)
		{
			// New window added - update all orbiters' target sphere index to the latest sphere
			let latestSphereIndex = currentWindowCount - 1;
			
			// Update all orbiters' target sphere index
			for (let i = 0; i < orbiters.length; i++)
			{
				orbiters[i].targetSphereIndex = latestSphereIndex;
			}
			
			// Save to localStorage immediately when new window is added
			saveOrbitersTargetSpheresToLocalStorage();
		}
		
		previousWindowCount = currentWindowCount;
		updateWindowSpheres();
	}

	function updateWindowSpheres ()
	{
		let wins = windowManager.getWindows();

		// remove all spheres
		windowSpheres.forEach((s) => {
			world.remove(s);
		})

		windowSpheres = [];

		// add new spheres based on the current window setup
		for (let i = 0; i < wins.length; i++)
		{
			let win = wins[i];

			let c = new t.Color();
			c.setHSL(i * .1, 1.0, .5);

			let s = 50 + i * 20;
			let sphere = new t.Mesh(new t.SphereGeometry(s * .5, 32, 32), new t.MeshBasicMaterial({color: c , wireframe: true}));
			sphere.position.x = win.shape.x + (win.shape.w * .5);
			sphere.position.y = win.shape.y + (win.shape.h * .5);

			world.add(sphere);
			windowSpheres.push(sphere);
		}
	}

	function updateWindowShape (easing = true)
	{
		// storing the actual offset in a proxy that we update against in the render function
		sceneOffsetTarget = {x: -window.screenX, y: -window.screenY};
		if (!easing) sceneOffset = sceneOffsetTarget;
	}


	function render ()
	{
		let currentTime = getTime();
		let deltaTime = lastRenderTime ? currentTime - lastRenderTime : 0.016;
		lastRenderTime = currentTime;
		deltaTime = Math.min(deltaTime, 0.2);

		windowManager.update();

		// calculate the new position based on the delta between current offset and new offset times a falloff value (to create the nice smoothing effect)
		let falloff = .05;
		sceneOffset.x = sceneOffset.x + ((sceneOffsetTarget.x - sceneOffset.x) * falloff);
		sceneOffset.y = sceneOffset.y + ((sceneOffsetTarget.y - sceneOffset.y) * falloff);

		// set the world position to the offset
		world.position.x = sceneOffset.x;
		world.position.y = sceneOffset.y;

		let wins = windowManager.getWindows();
		// loop through all our spheres and update their positions based on current window positions
		for (let i = 0; i < windowSpheres.length; i++)
		{
			let sphere = windowSpheres[i];
			let win = wins[i];
			if (!win) continue;

			let rotationTime = currentTime;

			let posTarget = {x: win.shape.x + (win.shape.w * .5), y: win.shape.y + (win.shape.h * .5)}

			sphere.position.x = sphere.position.x + (posTarget.x - sphere.position.x) * falloff;
			sphere.position.y = sphere.position.y + (posTarget.y - sphere.position.y) * falloff;
			sphere.rotation.x = rotationTime * .5;
			sphere.rotation.y = rotationTime * .3;
		};

		// Update orbiters - they will calculate centers from their target sphere indices in real-time
		updateOrbiters(windowSpheres, deltaTime);

		renderer.render(scene, camera);
		requestAnimationFrame(render);
	}


	// resize the renderer to fit the window size
	function resize ()
	{
		let width = window.innerWidth;
		let height = window.innerHeight
		
		camera = new t.OrthographicCamera(0, width, 0, height, -10000, 10000);
		camera.updateProjectionMatrix();
		renderer.setSize( width, height );
	}
}