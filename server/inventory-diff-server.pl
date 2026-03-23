#!/usr/bin/env perl
use Mojolicious::Lite -signatures;
use Mojo::Redis;
use Mojo::JSON qw(encode_json decode_json);

# ── Configuration from environment ────────────────────────────────────────────
my $REDIS_URL     = $ENV{INVDIFF_REDIS_URL}    // 'redis://localhost:6379';
my $CORS_ORIGIN   = $ENV{INVDIFF_CORS_ORIGIN}  // 'https://intel.ingress.com';
my $MAX_SNAPSHOTS = $ENV{INVDIFF_MAX_SNAPSHOTS} // 100;

# ── Redis helper ───────────────────────────────────────────────────────────────
helper redis => sub { state $r = Mojo::Redis->new($REDIS_URL) };

# ── CORS ───────────────────────────────────────────────────────────────────────
hook before_dispatch => sub ($c) {
    $c->res->headers->header('Access-Control-Allow-Origin'  => $CORS_ORIGIN);
    $c->res->headers->header('Access-Control-Allow-Methods' => 'POST, OPTIONS');
    $c->res->headers->header('Access-Control-Allow-Headers' => 'Content-Type');
    $c->res->headers->header('Access-Control-Max-Age'       => '86400');
};

# Preflight
options '/snapshots/:key' => sub ($c) { $c->rendered(204) };

# ── Validation ─────────────────────────────────────────────────────────────────
sub valid_key ($key) { $key =~ /^[0-9a-f]{64}$/ }

# ── POST /snapshots/:key ───────────────────────────────────────────────────────
# Body:    JSON array of client snapshots
# Returns: merged JSON array (server + client, sorted by timestamp, trimmed)
post '/snapshots/:key' => sub ($c) {
    my $key = $c->param('key');

    return $c->render(json => {error => 'invalid key'}, status => 400)
        unless valid_key($key);

    my $incoming = $c->req->json;
    return $c->render(json => {error => 'expected JSON array'}, status => 400)
        unless ref $incoming eq 'ARRAY';

    my $rkey   = "inv_diff:$key";
    my $db     = $c->redis->db;
    my $cutoff = time() * 1000 - 30 * 24 * 60 * 60 * 1000;

    # Apply deletes and TTL, then merge the rest
    for my $snap (@$incoming) {
        my $ts = $snap->{timestamp} or next;
        if ($snap->{deleted} || $ts < $cutoff) {
            $db->hdel($rkey, $ts);
        } else {
            $db->hset($rkey, $ts, encode_json($snap));
        }
    }

    # Fetch all, decode, filter expired, sort oldest → newest
    my $raw    = $db->hgetall($rkey);
    my @merged = sort { $a->{timestamp} <=> $b->{timestamp} }
                 grep { $_->{timestamp} >= $cutoff }
                 map  { decode_json($_) } values %$raw;

    # Trim oldest snapshots if over limit
    if (@merged > $MAX_SNAPSHOTS) {
        my @drop = splice @merged, 0, @merged - $MAX_SNAPSHOTS;
        $db->hdel($rkey, map { $_->{timestamp} } @drop);
    }

    # Refresh key TTL — auto-expire if no sync for 30 days
    $db->expire($rkey, 30 * 24 * 60 * 60);

    $c->render(json => \@merged);
};

app->start;
