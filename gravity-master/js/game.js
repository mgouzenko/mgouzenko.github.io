var game = new Phaser.Game(800, 600, Phaser.AUTO, '', { preload: preload, create: create, update: update });

function preload() {

    game.load.image('space', 'assets/space.png');
    game.load.image('star', 'assets/star.png');
    game.load.atlasJSONHash('fragments', 'assets/fragments.png', 'assets/fragments.json');
    game.load.atlasJSONHash('ship', 'assets/shipsheet.png', 'assets/shipsheet.json');
    game.load.image('moon', 'assets/moon.png');
    game.load.image('game_over', 'assets/game_over.png');

}

// Constants
var ANGULAR_VELOCITY = 3;
var MAX_ACCELERATION = 200;
var GRAVITY = 6000000;
var SHIP_SCALE = 0.25;
var MAX_EXPLOSION_SPEED = 20;

var fragment_map = {
    PIXEL_WIDTH: 160,
    PIXEL_HEIGHT: 280,
    WIDTH: 3,
    HEIGHT: 3,
    FRAGMENT_PREFIX: 'fragment_',
    FRAGMENT_SUFFIX: '.png',
    
    get_fragment: function(idx1, idx2){
        var pos = idx1 * 3 + idx2;
        return this.FRAGMENT_PREFIX + pos.toString() + this.FRAGMENT_SUFFIX; 
    },
}

// The player (ship)
var player;

// Fragments group
var fragments;

// The player's collision group
var player_collision_group;

// Game cursors
var cursors;

// The planets group
var planets;

// The planets collision group
var planet_collision_group;

// These are the fragments that the ship breaks into.
var fragment_collision_group;

// Game over text
var game_over_text;

var sum_of_da_forces = {x:0, y:0};

function planetary_body(xpos, ypos){
    this.xforce = 0;
    this.yforce = 0;
    this.xpos = xpos;
    this.ypos = ypos;
}

function planetary_body(sprite_name, scale, sprite_diameter, mass){
    this.name = sprite_name;
    this.scale = scale;
    this.radius = sprite_diameter * scale * 0.5;
    this.mass = mass;
}

function planet_factory(sprite_name, scale, sprite_diameter){
    this.name = sprite_name;
    this.scale = scale;
    this.sprite_diameter = sprite_diameter;

    this.make_planet = function(size){
        return new planetary_body(this.name,
                                  this.scale * size, 
                                  this.sprite_diameter,
                                  size * size); 
    };
}

var MOON = new planetary_body('moon', 0.25, 250);
var MOON_FACTORY = new planet_factory('moon', 0.25, 250);

function display_game_over_text(){
    game_over_text = game.add.sprite(game.camera.width/2,
                                     game.camera.height/2,
                                     'game_over')
    game_over_text.anchor.set(0.5);
    game_over_text.fixedToCamera = true;
    game.add.tween(game_over_text.scale).to({x: 0.5, y: 0.5}, 1000, Phaser.Easing.Back.InOut, true);
}

function explode(ship_body, planet_body){
    ship_body.sprite.kill();
    var xpos = ship_body.x;
    var ypos = ship_body.y;
    var xvel = ship_body.velocity.x;
    var yvel = ship_body.velocity.y;
    function make_random_speed(){
        var speed = Math.random() * MAX_EXPLOSION_SPEED;
        console.log(speed);
        return speed;
    };
    for(var i = 0; i < fragment_map.HEIGHT; i++){
        for(var j = 0; j < fragment_map.WIDTH; j++){
            
            fragment = fragments.create(xpos, ypos, 'fragments', fragment_map.get_fragment(i, j));
            game.physics.p2.enable(fragment);
            fragment.body.setCollisionGroup(fragment_collision_group);
            fragment.body.collides(planet_collision_group);
            fragment.scale.setTo(SHIP_SCALE, SHIP_SCALE);
            fragment.body.angle = ship_body.angle;
            fragment.body.velocity.x = -1 * xvel * make_random_speed();//-xvel*15*i;
            fragment.body.velocity.y = -1 * yvel * make_random_speed();//-yvel*15*j;
            fragment.body.collideWorldBounds = true;
        }
    }

    setTimeout(display_game_over_text, 1000);
}

function add_ship_to_game(phaser_game){
    
    ship = phaser_game.add.sprite(60, 60, 'ship', 'ship.png');

    // Make it a bit smaller.
    ship.scale.setTo(SHIP_SCALE, SHIP_SCALE);

    // We need to enable physics on the ship.
    phaser_game.physics.p2.enable(ship);
    
    // Add ship to collision group
    ship.body.setCollisionGroup(player_collision_group);
    ship.body.collides(planet_collision_group, explode, this);

    // Make ship collide with the world's boundaries.
    ship.body.collideWorldBounds = true;

    // Set the point of rotation to be in the middle of the body.
    ship.anchor.setTo(.5, .5);

    return ship;
}

function accelerateToObject(obj1, obj2) {
    // Get the angle between the two bodies.
    var angle = Math.atan2(obj2.y - obj1.y, obj2.x - obj1.x);
    
    // Get the square of the x and y offsets.
    var x_dist_squared = Math.pow(obj2.x - obj1.x, 2);
    var y_dist_squared = Math.pow(obj2.y - obj1.y, 2);
    var dist = 5000 + (x_dist_squared + y_dist_squared);

    var new_x_force = Math.cos(angle) * obj2.mass * GRAVITY * (1/dist);
    var new_y_force = Math.sin(angle) * obj2.mass * GRAVITY * (1/dist);

    sum_of_da_forces.x += new_x_force;
    sum_of_da_forces.y += new_y_force; 
    
}

function add_planet(group, xpos, ypos, body){
    var planet = group.create(xpos, ypos, body.name);
    game.physics.p2.enable(planet);
    planet.mass = body.mass;
    planet.scale.setTo(body.scale, body.scale); 
    planet.enableBody = true;
    planet.body.setCircle(body.radius);
    planet.body.static = true;
    planet.body.setCollisionGroup(planet_collision_group);
    planet.body.collides([player_collision_group, fragment_collision_group]);
}


function create() {

    game.world.setBounds(0, 0, 3000, 600);
    
    //  We're going to be using physics, so enable the P2 Physics system
    game.physics.startSystem(Phaser.Physics.P2JS);

    // Enable collisions
    game.physics.p2.setImpactEvents(true);
    
    // Make the collision groups
    player_collision_group = game.physics.p2.createCollisionGroup();
    planet_collision_group = game.physics.p2.createCollisionGroup();
    fragment_collision_group = game.physics.p2.createCollisionGroup();

    game.physics.p2.updateBoundsCollisionGroup();

    //  A simple background for our game
    game.add.tileSprite(0, 0, 3000, 600, 'space');

    // The player and his settings
    player = add_ship_to_game(game); 
    
    // Follow the player around the map with the camera.
    game.camera.follow(player);

    // Add planet group
    planets = game.add.group();

    // Add the fragments.
    fragments = game.add.group();

    // Add a planet
    add_planet(planets, 800, 400, MOON_FACTORY.make_planet(1));
    add_planet(planets, 400, 300, MOON_FACTORY.make_planet(2));

    //  Our controls.
    cursors = game.input.keyboard.createCursorKeys();
    console.log(player.frameName);
}

function accelerateShipToPlanet(p){
    accelerateToObject(player, p); 
}

function update() {
   
    planets.forEachAlive(accelerateShipToPlanet, this); 
    player.body.force.x += sum_of_da_forces.x;
    player.body.force.y += sum_of_da_forces.y;
 
    if (cursors.left.isDown)
    {
        //  Move to the left
        player.body.angularVelocity = -ANGULAR_VELOCITY;

    }
    else if (cursors.right.isDown)
    {
        //  Move to the right
        player.body.angularVelocity = ANGULAR_VELOCITY;
    }
    else
    {
        player.body.angularVelocity = 0;
    }

    if (cursors.up.isDown)
    {
        player.body.thrust(MAX_ACCELERATION);
    }

    sum_of_da_forces.x = 0;
    sum_of_da_forces.y = 0;
}
